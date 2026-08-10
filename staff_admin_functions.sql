-- =============================================================
-- 직원 관리 기능 정상화 (2026-08-10)
--
-- [문제]
-- resv_staff 테이블은 PIN이 REST로 노출되지 않도록 select 정책을 일부러 막아뒀습니다.
-- 그런데 PostgreSQL은 update/delete에 where 조건이 붙으면 그 행을 "읽을" 수 있어야 하고,
-- select 정책이 없으면 조건에 맞는 행이 0개로 취급됩니다.
-- 그래서 설정 화면의 직원 추가·PIN 재설정·비활성화가 오류 없이 조용히 아무것도 안 하고 있었습니다.
-- (요청은 성공(204)으로 돌아오지만 실제 값은 그대로였습니다)
--
-- [해결]
-- 로그인(resv_login)과 같은 방식으로, PIN을 밖으로 내보내지 않는
-- security definer 함수를 통해서만 직원 정보를 읽고 바꾸도록 합니다.
-- resv_staff 테이블의 select 차단은 그대로 유지되므로 PIN은 계속 안전합니다.
--
-- 새 쿼리 탭에 한 번만 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =============================================================

-- 1) 직원 목록 (PIN 제외, 비활성 직원도 포함해서 다시 활성화할 수 있게)
create or replace function resv_staff_list()
returns table(id bigint, name text, role text, store_id bigint, active boolean)
language sql
security definer
set search_path = public
as $$
  select s.id, s.name, s.role, s.store_id, s.active
  from resv_staff s
  order by s.active desc, s.name;
$$;

-- 2) 권한·소속 매장 변경
create or replace function resv_staff_set_role(p_id bigint, p_role text, p_store_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update resv_staff
     set role = p_role,
         store_id = p_store_id
   where id = p_id
     and p_role in ('staff','manager','admin');
$$;

-- 3) 사용/미사용 전환
create or replace function resv_staff_set_active(p_id bigint, p_active boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update resv_staff set active = p_active where id = p_id;
$$;

-- 4) PIN 재설정 (4자리 숫자만 허용)
create or replace function resv_staff_set_pin(p_id bigint, p_pin text)
returns void
language sql
security definer
set search_path = public
as $$
  update resv_staff set pin = p_pin
   where id = p_id and p_pin ~ '^[0-9]{4}$';
$$;

-- 5) 직원 추가
create or replace function resv_staff_add(p_name text, p_pin text, p_role text, p_store_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  insert into resv_staff(name, pin, role, store_id, active)
  select p_name, p_pin, p_role, p_store_id, true
  where p_pin ~ '^[0-9]{4}$'
    and p_role in ('staff','manager','admin')
    and coalesce(trim(p_name),'') <> ''
  on conflict (name) do nothing;
$$;

grant execute on function resv_staff_list()                                 to anon;
grant execute on function resv_staff_set_role(bigint, text, bigint)         to anon;
grant execute on function resv_staff_set_active(bigint, boolean)            to anon;
grant execute on function resv_staff_set_pin(bigint, text)                  to anon;
grant execute on function resv_staff_add(text, text, text, bigint)          to anon;

-- 6) A/S 상태에 '연락 두절'(no_answer) 추가
--    단순접수로 맡아둔 물건이 입고됐는데 고객 연락이 안 되는 건을 따로 구분하기 위해서입니다.
alter table resv_as_requests drop constraint if exists resv_as_requests_status_check;
alter table resv_as_requests add constraint resv_as_requests_status_check
  check (status in ('received','processing','ready','completed','erp_done',
                    'confirmed','sent_out','restocked','sent_branch','picked_up','no_answer'));

-- 7) 김형진 관리자 권한 부여
select resv_staff_set_role(id, 'admin', store_id) from resv_staff where name = '김형진';

-- 확인용 (실행 후 따로 돌려보세요)
-- select * from resv_staff_list();
