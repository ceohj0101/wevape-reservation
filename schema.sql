-- ============================================================
-- 위베이프 고객 예약 관리 (미취급 상품 예약 + AS 접수) 스키마
-- 기존 POS와 같은 Supabase 프로젝트에서 실행하세요.
-- 테이블명은 모두 resv_ 접두사를 붙여서 기존 POS 테이블과 겹치지 않게 했습니다.
-- Supabase 대시보드 > SQL Editor 에 이 파일 내용을 붙여넣고 실행(Run)하면 됩니다.
-- ============================================================

-- 1. 매장
create table if not exists resv_stores (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true
);

insert into resv_stores (name, sort_order) values
  ('구월로데오', 1), ('연수', 2), ('인천공항', 3), ('논현', 4), ('구월길병원', 5),
  ('계산', 6), ('부천상동', 7), ('부천중동', 8), ('을지로', 9), ('검단', 10)
on conflict (name) do nothing;

-- 2. 직원 (이름 선택 + PIN 로그인)
-- store_id가 null이면 전매장 권한
create table if not exists resv_staff (
  id bigint generated always as identity primary key,
  name text not null,
  pin text not null,
  role text not null default 'staff' check (role in ('staff','manager','admin')),
  store_id bigint references resv_stores(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 최초 관리자 계정 예시 (배포 후 반드시 이름/PIN 변경하세요)
-- 이름 중복 방지용 유니크 제약을 걸기 전에, 예전에 스키마를 여러 번 실행해서 이미 중복 저장된
-- 이름이 있으면 정리합니다 (같은 이름이면 가장 먼저 만들어진 행 하나만 남기고 나머지는 삭제).
delete from resv_staff a using resv_staff b
where a.name = b.name and a.id > b.id;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'resv_staff_name_key') then
    alter table resv_staff add constraint resv_staff_name_key unique (name);
  end if;
end $$;

insert into resv_staff (name, pin, role, store_id)
  values ('실장님', '0000', 'manager', null)
  on conflict (name) do nothing;

-- 실제 재직 중 직원 명단 (2026-08-08 기준). PIN은 전부 기본값 0000으로 넣어뒀으니
-- 설정 탭에서 직원별로 담당 매장 지정 + PIN을 꼭 변경해주세요.
insert into resv_staff (name, pin, role, store_id) values
  ('신재현','0000','staff',null), ('홍다운','0000','staff',null), ('장현진','0000','staff',null),
  ('독고명록','0000','staff',null), ('김형진','0000','staff',null), ('정희경','0000','staff',null),
  ('김다정','0000','staff',null), ('이종혁','0000','staff',null), ('장대운','0000','staff',null),
  ('조효정','0000','staff',null), ('차영근','0000','staff',null), ('고아현','0000','staff',null),
  ('원주현','0000','staff',null), ('정유진','0000','staff',null), ('안태민','0000','staff',null),
  ('김상훈','0000','staff',null), ('최민영','0000','staff',null)
on conflict (name) do nothing;

-- PIN이 그대로 REST API로 노출되지 않도록, 이름 목록용 뷰는 PIN을 뺀 버전으로 따로 둡니다.
create or replace view resv_staff_public as
  select id, name, role, store_id, active from resv_staff where active = true;

-- 로그인 확인은 이 함수를 통해서만 하고, resv_staff 테이블 자체는 anon이 직접 select 할 수 없게 막습니다.
-- security definer로 만들어서 함수 내부에서는 PIN 비교가 가능하지만, 클라이언트로는 PIN이 절대 내려가지 않습니다.
create or replace function resv_login(p_staff_id bigint, p_pin text)
returns table(id bigint, name text, role text, store_id bigint)
language sql
security definer
set search_path = public
as $$
  select id, name, role, store_id
  from resv_staff
  where id = p_staff_id and pin = p_pin and active = true;
$$;

-- 3. 접수 사유 옵션 (미취급상품 문의 / AS 접수 공통 관리, type으로 구분)
create table if not exists resv_reason_options (
  id bigint generated always as identity primary key,
  type text not null check (type in ('product_request','as')),
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

insert into resv_reason_options (type, label, sort_order) values
  ('product_request','지인 추천',1),
  ('product_request','SNS/후기에서 봄',2),
  ('product_request','타 매장에서 판매중',3),
  ('product_request','가격 비교',4),
  ('product_request','단순 문의',5),
  ('product_request','기타',6),
  ('as','배터리 불량',1),
  ('as','발열 이상',2),
  ('as','액상 누출',3),
  ('as','화면/버튼 고장',4),
  ('as','충전 불량',5),
  ('as','파손',6),
  ('as','기타',7)
on conflict do nothing;

-- 4. 상품 예약 (미취급 상품 + 품절 상품 — request_type으로 구분)
-- request_type: unstocked(미취급 상품) / out_of_stock(품절 상품)
-- status: requested(문의접수) -> approved(발주가능)/rejected(발주불가)
--         -> arrived(입고완료) -> contacted(연락완료) -> purchased(구매완료)/abandoned(구매포기)
create table if not exists resv_product_requests (
  id bigint generated always as identity primary key,
  store_id bigint not null references resv_stores(id),
  product_name text not null,
  request_type text not null default 'unstocked' check (request_type in ('unstocked','out_of_stock')),
  reason_id bigint references resv_reason_options(id),
  memo text,
  customer_name text,
  customer_phone text,
  status text not null default 'requested'
    check (status in ('requested','rejected','approved','arrived','contacted','purchased','abandoned')),
  reject_reason text,
  requested_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  arrived_at timestamptz,
  contacted_at timestamptz,
  contact_result text,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존에 이미 스키마를 실행해서 테이블이 있는 경우를 위한 안전한 컬럼 추가 (신규 설치 시에는 위 create table에서 이미 생성되어 아무 영향 없음)
alter table resv_product_requests add column if not exists request_type text not null default 'unstocked';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'resv_product_requests_request_type_check') then
    alter table resv_product_requests add constraint resv_product_requests_request_type_check check (request_type in ('unstocked','out_of_stock'));
  end if;
end $$;

create index if not exists idx_resv_pr_store on resv_product_requests(store_id);
create index if not exists idx_resv_pr_status on resv_product_requests(status);
create index if not exists idx_resv_pr_product_name on resv_product_requests(product_name);
create index if not exists idx_resv_pr_type on resv_product_requests(request_type);

-- 5. AS 접수 (기기 고장/불량 수리·교환)
-- category: hq(본사 제품) / other(타사 제품) — 카테고리별로 상태 흐름이 다릅니다.
--   hq    : received(접수완료) -> erp_done(ERP 기입완료)
--   other : received(지점접수) -> confirmed(접수확인) -> sent_out(발송·검사중)
--           -> restocked(재입고완료) -> sent_branch(지점발송완료) -> picked_up(고객수령완료)
create table if not exists resv_as_requests (
  id bigint generated always as identity primary key,
  store_id bigint not null references resv_stores(id),
  device_name text not null,
  category text not null default 'hq' check (category in ('hq','other')),
  product_family text,
  product_type text,
  product_option text,
  service_method text default '현장교체' check (service_method in ('현장교체','단순접수')),
  contact_mode text not null default 'full' check (contact_mode in ('full','last4')),
  received_date date default current_date,
  reason_id bigint references resv_reason_options(id),
  defect_reason text,
  defect_detail text,
  report_key text,
  symptom_memo text,
  customer_name text,
  customer_phone text,
  status text not null default 'received'
    check (status in ('received','processing','ready','completed','erp_done','confirmed','sent_out','restocked','sent_branch','picked_up')),
  result text check (result in ('free_repair','paid_repair','exchange','refund','unable')),
  requested_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존에 이미 테이블이 있는 설치본을 위한 안전한 컬럼/제약 추가 (신규 설치는 위 create table에서 이미 반영됨)
alter table resv_as_requests add column if not exists category text not null default 'hq';
alter table resv_as_requests add column if not exists product_family text;
alter table resv_as_requests add column if not exists product_type text;
alter table resv_as_requests add column if not exists product_option text;
alter table resv_as_requests add column if not exists service_method text default '현장교체';
alter table resv_as_requests add column if not exists contact_mode text not null default 'full';
alter table resv_as_requests add column if not exists received_date date default current_date;
alter table resv_as_requests alter column received_date drop not null;
alter table resv_as_requests add column if not exists defect_reason text;
alter table resv_as_requests add column if not exists defect_detail text;
alter table resv_as_requests add column if not exists report_key text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'resv_as_requests_category_check') then
    alter table resv_as_requests add constraint resv_as_requests_category_check check (category in ('hq','other'));
  end if;
end $$;

alter table resv_as_requests drop constraint if exists resv_as_requests_status_check;
alter table resv_as_requests add constraint resv_as_requests_status_check
  check (status in ('received','processing','ready','completed','erp_done','confirmed','sent_out','restocked','sent_branch','picked_up'));

create index if not exists idx_resv_as_store on resv_as_requests(store_id);
create index if not exists idx_resv_as_status on resv_as_requests(status);
create index if not exists idx_resv_as_category on resv_as_requests(category);
create index if not exists idx_resv_as_report_key on resv_as_requests(report_key);
create index if not exists idx_resv_as_received_date on resv_as_requests(received_date);

-- 6. 사진 첨부 (문의/기기 사진) — Storage 사용
alter table resv_product_requests add column if not exists photo_urls text[] not null default '{}';
alter table resv_as_requests add column if not exists photo_urls text[] not null default '{}';

-- 사진 저장용 버킷. 공개(public) 버킷으로 만들어서 anon key로 바로 업로드/조회 가능하게 합니다.
-- (기존 테이블들과 동일한 보안 수준 — 추후 보안 강화 시 같이 다룰 예정)
insert into storage.buckets (id, name, public)
values ('resv-photos', 'resv-photos', true)
on conflict (id) do nothing;

drop policy if exists "resv photos anon select" on storage.objects;
create policy "resv photos anon select" on storage.objects
  for select using (bucket_id = 'resv-photos');

drop policy if exists "resv photos anon insert" on storage.objects;
create policy "resv photos anon insert" on storage.objects
  for insert with check (bucket_id = 'resv-photos');

drop policy if exists "resv photos anon delete" on storage.objects;
create policy "resv photos anon delete" on storage.objects
  for delete using (bucket_id = 'resv-photos');

-- 7. updated_at 자동 갱신
create or replace function resv_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_resv_pr_updated on resv_product_requests;
create trigger trg_resv_pr_updated before update on resv_product_requests
  for each row execute function resv_set_updated_at();

drop trigger if exists trg_resv_as_updated on resv_as_requests;
create trigger trg_resv_as_updated before update on resv_as_requests
  for each row execute function resv_set_updated_at();

-- 8. RLS (Row Level Security)
-- 기존 POS와 동일하게 우선은 anon key 전체 접근 허용으로 시작합니다.
-- (기존 POS도 아직 이 단계이며, 보안 강화는 추후 공통 과제로 진행 예정)
alter table resv_stores enable row level security;
alter table resv_staff enable row level security;
alter table resv_reason_options enable row level security;
alter table resv_product_requests enable row level security;
alter table resv_as_requests enable row level security;

drop policy if exists "anon full access" on resv_stores;
create policy "anon full access" on resv_stores for all using (true) with check (true);

-- resv_staff는 PIN이 들어있어서 anon이 직접 select 하지 못하게 select 정책을 만들지 않습니다.
-- (이름 목록은 위의 resv_staff_public 뷰로, 로그인 확인은 resv_login 함수로만 처리)
-- 설정 탭에서 직원 추가/PIN 변경은 가능해야 하므로 insert/update/delete는 열어둡니다.
drop policy if exists "anon insert" on resv_staff;
create policy "anon insert" on resv_staff for insert with check (true);
drop policy if exists "anon update" on resv_staff;
create policy "anon update" on resv_staff for update using (true) with check (true);
drop policy if exists "anon delete" on resv_staff;
create policy "anon delete" on resv_staff for delete using (true);

grant select on resv_staff_public to anon;
grant execute on function resv_login(bigint, text) to anon;

drop policy if exists "anon full access" on resv_reason_options;
create policy "anon full access" on resv_reason_options for all using (true) with check (true);

drop policy if exists "anon full access" on resv_product_requests;
create policy "anon full access" on resv_product_requests for all using (true) with check (true);

drop policy if exists "anon full access" on resv_as_requests;
create policy "anon full access" on resv_as_requests for all using (true) with check (true);
