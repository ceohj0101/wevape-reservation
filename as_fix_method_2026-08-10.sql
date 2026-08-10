-- =============================================================
-- 접수방식 미표기 건 정리 (2026-08-10)
--
-- 원본 시트에서 '현장 교체'/'단순 접수' 칸이 둘 다 비어 있던 272건입니다.
-- 재이관할 때 이 건들을 임의로 '현장교체'로 넣었는데, 실제로는 알 수 없는 값입니다.
-- 단순접수 건이 현장교체로 묻히면 "입고 후 고객 인계" 절차를 안 타서
-- 고객이 기다리는 물건을 놓칠 수 있어, 값을 비워두고 앱에서 직접 분류하도록 되돌립니다.
--
-- 대상: 재이관 배치(id 1159~2192) 중 원본에 표기가 없던 건만.
-- 새 쿼리 탭에 한 번만 붙여넣고 Run 하세요. 여러 번 실행해도 결과는 같습니다.
-- =============================================================

begin;

update resv_as_requests
   set service_method = null
 where (id between 1159 and 1161) or
       (id between 1186 and 1215) or
       (id between 1218 and 1221) or
       (id = 1239) or
       (id between 1282 and 1284) or
       (id between 1398 and 1399) or
       (id between 1499 and 1503) or
       (id between 1542 and 1546) or
       (id between 1582 and 1585) or
       (id between 1590 and 1602) or
       (id = 1626) or
       (id = 1760) or
       (id = 1769) or
       (id between 1799 and 1805) or
       (id = 1808) or
       (id between 1891 and 1958) or
       (id between 1968 and 2017) or
       (id between 2024 and 2038) or
       (id = 2067) or
       (id between 2072 and 2123) or
       (id between 2188 and 2192);

commit;

-- 확인용
-- select count(*) filter (where service_method is null) as 미확인,
--        count(*) filter (where service_method = '현장교체') as 현장교체,
--        count(*) filter (where service_method = '단순접수') as 단순접수
-- from resv_as_requests;
