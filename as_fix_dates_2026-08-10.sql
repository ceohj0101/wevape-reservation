-- =============================================================
-- 접수일자 오타 5건 정정 (2026-08-10)
-- 원본 시트에 날짜가 오타로 적혀 있어 날짜로 읽히지 않았고,
-- 그 결과 '발송월 기준 추정'으로 들어간 5건입니다.
-- 앞뒤 행의 날짜 순서로 실제 접수일이 확정되어 바로잡습니다.
--   26.0809   → 2026-08-09  (26.08.08 과 26.08.10 사이)
--   26.07319  → 2026-07-19  (26.07.18 과 26.07.19 사이)
--   26.26.20  → 2026-06-20  (26.06.17 과 26.06.21 사이)
--   26.26.25  → 2026-06-25  (26.06.25 행들 사이)
--   04//12    → 2026-04-12  (2026-04-11 과 2026-04-13 사이)
-- =============================================================

begin;

-- 구월길병원 · 롤리팟-J 블루 · 원본 '04//12' → 2026-04-12
update resv_as_requests a set
  received_date = date '2026-04-12',
  symptom_memo  = '자석빠짐'
from resv_stores s
where s.id = a.store_id
  and s.name = '구월길병원'
  and a.device_name = '롤리팟-J 블루'
  and a.symptom_memo = '자석빠짐 [접수일 미기재 — 발송월 기준 추정]'
  and a.received_date = date '2026-04-01';

-- 구월로데오 · 롤리팟 j 핑크 · 원본 '26.07319' → 2026-07-19
update resv_as_requests a set
  received_date = date '2026-07-19',
  symptom_memo  = '에어홀 탈락'
from resv_stores s
where s.id = a.store_id
  and s.name = '구월로데오'
  and a.device_name = '롤리팟 j 핑크'
  and a.symptom_memo = '에어홀 탈락 [접수일 미기재 — 발송월 기준 추정]'
  and a.received_date = date '2026-07-01';

-- 구월로데오 · 그래피티c 수박블루베리 · 원본 '26.0809' → 2026-08-09
update resv_as_requests a set
  received_date = date '2026-08-09',
  symptom_memo  = '초기인식불량'
from resv_stores s
where s.id = a.store_id
  and s.name = '구월로데오'
  and a.device_name = '그래피티c 수박블루베리'
  and a.symptom_memo = '초기인식불량 [접수일 미기재 — 발송월 기준 추정]'
  and a.received_date = date '2026-10-01';

-- 계산 · PA15 쿨민트 · 원본 '26.26.20' → 2026-06-20
update resv_as_requests a set
  received_date = date '2026-06-20',
  symptom_memo  = '전원불량'
from resv_stores s
where s.id = a.store_id
  and s.name = '계산'
  and a.device_name = 'PA15 쿨민트'
  and a.symptom_memo = '전원불량 [접수일 미기재 — 발송월 기준 추정]'
  and a.received_date = date '2026-06-01';

-- 계산 · 그래피티C 기기 블랙 · 원본 '26.26.25' → 2026-06-25
update resv_as_requests a set
  received_date = date '2026-06-25',
  symptom_memo  = '간헐적작동불량'
from resv_stores s
where s.id = a.store_id
  and s.name = '계산'
  and a.device_name = '그래피티C 기기 블랙'
  and a.symptom_memo = '간헐적작동불량 [접수일 미기재 — 발송월 기준 추정]'
  and a.received_date = date '2026-06-01';

commit;

-- 확인용: 아래를 돌리면 9월 이후 날짜나 추정 표시가 남았는지 볼 수 있습니다.
-- select count(*) filter (where received_date >= date '2026-09-01') as 미래날짜,
--        count(*) filter (where symptom_memo like '%발송월 기준 추정%') as 추정건수
-- from resv_as_requests;