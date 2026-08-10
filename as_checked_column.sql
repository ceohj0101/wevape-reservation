-- =============================================================
-- A/S 접수 확인 체크 기능 (2026-08-10)
--
-- 전 매장 A/S 물품을 받아서 확인·처리하는 담당자가,
-- 실제로 물건이 들어온 것을 눈으로 확인했는지 표시할 수 있도록 컬럼을 추가합니다.
-- (목록에서 "미확인 / 확인 완료"로 구분하고, 미확인 건만 따로 걸러볼 수 있습니다)
--
-- 새 쿼리 탭에 한 번만 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =============================================================

alter table resv_as_requests add column if not exists checked_at timestamptz;
alter table resv_as_requests add column if not exists checked_by text;

-- 확인용
-- select count(*) filter (where checked_at is null) as 미확인,
--        count(*) filter (where checked_at is not null) as 확인완료
-- from resv_as_requests;
