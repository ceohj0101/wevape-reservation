const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

function serve(){
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if(p === '/') p = '/index.html';
    const full = path.join(ROOT, p);
    fs.readFile(full, (err, data) => {
      if(err){ res.writeHead(404); res.end('not found: '+p); return; }
      const ext = path.extname(full);
      const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
      res.writeHead(200, {'Content-Type': type});
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if(msg.type()==='error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  // Redirect CDN script requests to local mocks.
  await page.route('**/cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => {
    route.fulfill({ contentType: 'application/javascript', path: path.join(__dirname, 'mock-libs.js') });
  });
  await page.route('**/cdn.jsdelivr.net/npm/chart.js@4', route => {
    route.fulfill({ contentType: 'application/javascript', body: '/* chart.js stubbed via mock-libs.js */' });
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForTimeout(300);

  function assert(cond, msg){
    if(!cond){ console.log('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
  }

  // ---- Login as 신재현 (staff, pin 0000) ----
  await page.selectOption('#login-staff', { label: '신재현' });
  for(const d of ['0','0','0','0']) await page.click(`#keypad button[data-k="${d}"]`);
  await page.waitForTimeout(300);
  assert(await page.isVisible('#app'), '로그인 성공 후 앱(사이드바 구조) 표시');
  assert(await page.isVisible('#view-product.active'), '로그인 직후 첫 화면 = 상품 예약 접수');
  assert(await page.isVisible('#pr-new-btn'), '접수 화면에 "+ 새 상품 예약" 버튼 바로 노출');
  const menuOrder = await page.$$eval('.sidebar nav button', els => els.map(e=>e.dataset.tab));
  assert(JSON.stringify(menuOrder) === JSON.stringify(['product','prstats','as','asstats','settings']),
    `메뉴 순서 = 예약접수·예약통계·AS접수·AS통계·설정 (실제 ${menuOrder.join(',')})`);
  assert(await page.isVisible('#install-btn'), '사이드바에 "바탕화면에 설치" 버튼 노출');
  assert((await page.textContent('.sidebar .brand')).includes('예약 및 AS 관리'), '앱 이름이 "예약 및 AS 관리"로 표시');

  // ---- 월 바: 이번 달이 기본 + 지난달 이전 미완료 바로가기 ----
  assert(await page.isVisible('#pr-month-bar select'), '예약 화면에 월 선택 표시');
  const prMonthVal = await page.$eval('#pr-month-bar select', el => el.value);
  assert(prMonthVal === 'this', `예약 월 기본값 = 이번 달 (실제 ${prMonthVal})`);
  assert((await page.textContent('#pr-month-bar')).includes('지난달 이전 미완료'), '예약 화면에 지난달 미완료 버튼 표시');

  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(300);
  assert(await page.isVisible('#as-month-bar select'), 'AS 화면에 월 선택 표시');
  const asMonthVal = await page.$eval('#as-month-bar select', el => el.value);
  assert(asMonthVal === 'this', `AS 월 기본값 = 이번 달 (실제 ${asMonthVal})`);
  await page.selectOption('#as-month-bar select', 'all');
  await page.waitForTimeout(350);
  assert((await page.$eval('#as-month-bar select', el=>el.value)) === 'all', 'AS 월을 전체 기간으로 변경 가능');
  await page.click('.sidebar nav button[data-tab="product"]');
  await page.waitForTimeout(300);

  // 통계 기간 필터는 전체기간 / 직접설정 두 가지만
  await page.click('.sidebar nav button[data-tab="asstats"]');
  await page.waitForTimeout(300);
  const periodOpts = await page.$$eval('#as-stat-period option', els => els.map(e=>e.value));
  assert(JSON.stringify(periodOpts) === JSON.stringify(['all','custom']),
    `AS 통계 기간 옵션 = 전체기간·직접설정 (실제 ${periodOpts.join(',')})`);
  const prPeriodOpts = await page.$$eval('#pr-stat-period option', els => els.map(e=>e.value));
  assert(JSON.stringify(prPeriodOpts) === JSON.stringify(['all','custom']),
    `예약 통계 기간 옵션도 동일 (실제 ${prPeriodOpts.join(',')})`);

  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(300);

  // ---- 각 탭 상단의 단계 스트립 ----
  const scopeLabel0 = (await page.textContent('#as-current-store-name')).trim();
  assert(scopeLabel0.length > 0 && scopeLabel0 !== '-', `첫 진입부터 "보는 범위" 라벨이 채워져 있음 (실제 "${scopeLabel0}")`);
  const scopeSel0 = await page.$eval('#as-scope-select', el => el.value);
  assert(scopeSel0 !== '' , `범위 드롭다운도 같은 값으로 동기화 (실제 "${scopeSel0}")`);
  assert(await page.isVisible('#as-stage-strip'), 'AS 탭 상단에 단계 스트립 표시');
  const asStrips = await page.$$eval('#as-stage-strip .stage-strip', els => els.length);
  assert(asStrips >= 1, `AS 탭에 단계 스트립이 최소 1줄 표시 (실제 ${asStrips})`);
  const asHead = await page.textContent('#as-stage-strip');
  assert(asHead.includes('본사 제품'), 'AS 스트립에 본사 제품 흐름 표시');
  assert(!asHead.includes('문의접수'), 'AS 탭에는 예약 단계가 섞여 나오지 않음');

  await page.click('.sidebar nav button[data-tab="product"]');
  await page.waitForTimeout(300);
  assert(await page.isVisible('#pr-stage-strip'), '상품 예약 탭 상단에 단계 스트립 표시');
  const prHead = await page.textContent('#pr-stage-strip');
  assert(prHead.includes('문의접수') && prHead.includes('구매완료'), '예약 스트립에 예약 단계 표시');
  assert(!prHead.includes('ERP 기입'), '예약 탭에는 AS 단계가 섞여 나오지 않음');
  const prStrips = await page.$$eval('#pr-stage-strip .stage-strip', els => els.length);
  assert(prStrips === 1, `예약 스트립은 1개 (실제 ${prStrips})`);

  // ---- Go to AS tab ----
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#view-as.active'), 'AS 접수 탭 활성화');

  // ================= Case 1: 본사 제품 (그래피티C 배터리) =================
  await page.click('#as-new-btn');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#f-as-product-area'), '등록 모달의 제품 영역 표시');
  assert(await page.isVisible('#f-staff'), '등록 모달에 접수자 선택 필드 표시(매장 아래)');
  const staffDefault = await page.$eval('#f-staff', el => el.value);
  assert(staffDefault === '신재현', `접수자 기본값 = 로그인한 사람 (실제 ${staffDefault})`);
  await page.selectOption('#f-staff', '실장님');

  // hq는 기본 선택이어야 함
  const hqActive = await page.$eval('#f-as-cat-toggle button[data-cat="hq"]', el => el.classList.contains('active'));
  assert(hqActive, '기본 카테고리는 본사 제품');

  await page.fill('#f-as-product-search', '그래피티C');
  await page.waitForTimeout(150);
  const resultCount = await page.$$eval('.as-search-item', els => els.length);
  assert(resultCount > 0, `그래피티C 검색 결과 ${resultCount}건 노출`);

  // 배터리 옵션 하나 선택 (검색결과 중 "배터리 [블랙]" 텍스트가 들어간 항목 클릭)
  const items = await page.$$('.as-search-item');
  let picked = false;
  for(const it of items){
    const t = await it.textContent();
    if(t.includes('배터리') && t.includes('블랙') && !t.includes('미러')){
      await it.click(); picked = true; break;
    }
  }
  assert(picked, '그래피티C 배터리[블랙] 옵션 선택');
  await page.waitForTimeout(150);
  assert(await page.isVisible('.as-picked-chip'), '선택된 제품 칩 표시');
  assert(await page.isVisible('#f-defect-reason'), '추적 대상 제품 → 불량사유 select 노출');

  await page.selectOption('#f-defect-reason', { label: '인식·접촉 불량' });
  await page.fill('#f-defect-detail', '충전은 되는데 흡입이 간헐적으로 안됨');
  await page.fill('#f-cname', '김고객');
  await page.fill('#f-cphone', '010-1234-5678');
  await page.fill('#f-memo', '어제 구매, 매장 재방문');

  await page.click('#modal-body .btn-primary');
  await page.waitForTimeout(300);
  assert(!(await page.isVisible('#modal-overlay.open')), '등록 후 모달 닫힘');

  const row1 = await page.textContent('#as-list');
  assert(row1.includes('그래피티C') && row1.includes('김고객'), 'AS 목록에 신규 접수 표시');
  assert(row1.includes('등록 실장님'), '선택한 접수자(실장님)가 등록자로 저장됨');
  assert(row1.includes('본사 제품'), '목록 카테고리 배지 = 본사 제품');
  assert(row1.includes('접수'), '목록 상태 배지 = 접수(초기 상태)');

  // 상세 열기 + 파이프라인 확인 (hq flow: 접수완료 -> ERP 기입완료, 2단계)
  await page.click('#as-list .row');
  await page.waitForTimeout(200);
  const detailHtml = await page.textContent('#as-detail');
  assert(detailHtml.includes('불량 사유') && detailHtml.includes('인식·접촉 불량'), '상세에 불량사유 노출');
  assert(detailHtml.includes('상세 내용') && detailHtml.includes('흡입이 간헐적'), '상세에 defect_detail 노출');
  const nodeCountHq = await page.$$eval('#as-detail .pipeline .node', els => els.length);
  assert(nodeCountHq === 2, `본사 제품 파이프라인 노드 2개 (실제 ${nodeCountHq})`);

  await page.click('#as-detail button:has-text("ERP 기입 완료 처리")');
  await page.waitForTimeout(300);
  const detailHtml2 = await page.textContent('#as-detail');
  assert(detailHtml2.includes('ERP 기입완료') || detailHtml2.includes('ERP 기입 완료'), 'ERP 기입완료로 상태 전환');
  const statusTagDone = await page.$$eval('#as-list .row .tag.status-purchased', els => els.length);
  assert(statusTagDone >= 1, '완료 상태 목록에서 완료 배지(초록) 표시');

  // ================= Case 2: 타사 제품 (자유 입력, 파이프라인 6단계) =================
  await page.click('#as-new-btn');
  await page.waitForTimeout(150);
  await page.click('#f-as-cat-toggle button[data-cat="other"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#f-device'), '타사 제품 선택 시 자유 입력 필드 노출');
  await page.fill('#f-device', '타사 브랜드 X 기기');
  await page.fill('#f-cname', '박고객');
  await page.fill('#f-cphone', '9876'); // 뒷4자리만
  await page.click('#f-as-contact-toggle button[data-c="last4"]');
  await page.fill('#f-memo', '전원이 안 켜짐');
  await page.click('#modal-body .btn-primary');
  await page.waitForTimeout(300);

  // 타사 제품 탭으로 필터링해서 확인
  await page.click('#as-category-tabs button[data-cat="other"]');
  await page.waitForTimeout(150);
  const otherListHtml = await page.textContent('#as-list');
  assert(otherListHtml.includes('타사 브랜드 X 기기') && otherListHtml.includes('박고객'), '타사 제품 목록에 표시');

  await page.click('#as-list .row');
  await page.waitForTimeout(200);
  const nodeCountOther = await page.$$eval('#as-detail .pipeline .node', els => els.length);
  assert(nodeCountOther === 6, `타사 제품 파이프라인 노드 6개 (실제 ${nodeCountOther})`);
  const contactModeText = await page.textContent('#as-detail');
  assert(contactModeText.includes('뒷 4자리만 수집'), '연락처 수집방식(뒷4자리) 표시');

  // 2단계 진행 후 되돌리기 테스트
  await page.click('#as-detail button:has-text("처리")'); // advance once (지점 접수 -> 로데오점 접수확인)
  await page.waitForTimeout(250);
  await page.click('#as-detail button:has-text("처리")'); // advance twice
  await page.waitForTimeout(250);
  let nextActionLabel = await page.textContent('#as-detail .detail-actions');
  assert(nextActionLabel.includes('재입고 완료 처리'), `2회 진행 후 다음 단계 버튼 = 재입고 완료 처리 (실제: ${nextActionLabel.trim()})`);
  await page.click('#as-detail button:has-text("이전 단계로")');
  await page.waitForTimeout(250);
  nextActionLabel = await page.textContent('#as-detail .detail-actions');
  assert(nextActionLabel.includes('제조사 발송·검사중 처리'), `되돌리기 후 다음 단계 버튼 = 제조사 발송·검사중 처리 (실제: ${nextActionLabel.trim()})`);

  // ================= AS 통계 — 중복 증상 집계 확인 =================
  await page.click('.sidebar nav button[data-tab="asstats"]');
  await page.waitForTimeout(300);
  const statsHtml = await page.textContent('#as-symptom-rank');
  assert(statsHtml.includes('그래피티C'), '통계 - 증상 랭킹에 그래피티C 항목 표시');
  assert(statsHtml.includes('인식·접촉 불량') || statsHtml.includes('전원이 안'), '통계 - 증상 라벨(불량사유/메모) 표시');

  // 케이스 목록 펼치기
  const firstRow = await page.$('.rank-bar-row.clickable');
  assert(!!firstRow, '증상 랭킹 바 존재');
  if(firstRow){
    await firstRow.click();
    await page.waitForTimeout(150);
    const caseListOpen = await page.$$eval('.rank-case-list.open', els => els.length);
    assert(caseListOpen >= 1, '증상 클릭 시 케이스 목록 펼쳐짐');
    const caseText = await page.textContent('.rank-case-list.open');
    assert(caseText.includes('김고객') || caseText.includes('박고객'), '펼쳐진 케이스에 고객 정보 표시');
  }

  // ================= AS 통계 — 월별 필터 확인 =================
  const monthOptions = await page.$$eval('#as-stat-month option', els => els.map(e=>e.value));
  assert(monthOptions.includes('2026-08'), '월 필터에 이번 달(2026-08) 옵션 존재');
  await page.selectOption('#as-stat-month', '2026-08');
  await page.waitForTimeout(250);
  const cardsThisMonth = await page.textContent('#as-stat-cards');
  assert(cardsThisMonth.includes('2건') || /[1-9]\d*건/.test(cardsThisMonth), '이번 달 필터 시 접수 건수 표시');
  const periodDisabled = await page.$eval('#as-stat-period', el => el.disabled);
  assert(periodDisabled, '월 필터가 특정 월일 때 기간 셀렉트 비활성화');
  await page.selectOption('#as-stat-month', '2026-01');
  await page.waitForTimeout(250);
  const cardsOtherMonth = await page.textContent('#as-stat-cards');
  assert(cardsOtherMonth.includes('전체 AS 접수') && cardsOtherMonth.match(/0건/), '데이터 없는 월 선택 시 0건 표시');
  await page.selectOption('#as-stat-month', 'all');
  await page.waitForTimeout(250);
  const periodEnabledAgain = await page.$eval('#as-stat-period', el => el.disabled);
  assert(!periodEnabledAgain, '전체 월로 되돌리면 기간 셀렉트 다시 활성화');

  // ================= AS 통계 — 기간 직접 설정(커스텀 범위) 확인 =================
  const rangeHiddenInitially = await page.$eval('#as-stat-custom-range', el => getComputedStyle(el).display === 'none');
  assert(rangeHiddenInitially, '기본 상태에서는 직접 기간 입력칸이 숨겨져 있음');
  await page.selectOption('#as-stat-period', 'custom');
  await page.waitForTimeout(150);
  const rangeVisible = await page.$eval('#as-stat-custom-range', el => getComputedStyle(el).display !== 'none');
  assert(rangeVisible, '"기간 직접 설정" 선택 시 날짜 입력칸 노출');
  // 미래 구간(데이터가 있을 수 없는 범위)을 지정하면 0건이 나와야 함
  await page.fill('#as-stat-from', '2030-01-01');
  await page.fill('#as-stat-to', '2030-01-31');
  await page.waitForTimeout(250);
  const cardsFutureRange = await page.textContent('#as-stat-cards');
  assert(cardsFutureRange.includes('전체 AS 접수') && cardsFutureRange.match(/0건/), '미래 날짜로 직접 기간 설정 시 0건 표시');
  // 오늘을 포함하는 넓은 범위로 바꾸면 방금 등록한 테스트 케이스가 다시 잡혀야 함
  await page.fill('#as-stat-from', '2020-01-01');
  await page.fill('#as-stat-to', '2030-12-31');
  await page.waitForTimeout(250);
  const cardsWideRange = await page.textContent('#as-stat-cards');
  assert(/[1-9]\d*건/.test(cardsWideRange), '오늘을 포함하는 넓은 직접 기간 설정 시 접수 건수 다시 표시');
  await page.selectOption('#as-stat-month', '2026-08');
  await page.waitForTimeout(150);
  const rangeHiddenWhenMonthPicked = await page.$eval('#as-stat-custom-range', el => getComputedStyle(el).display === 'none');
  assert(rangeHiddenWhenMonthPicked, '월을 선택하면 직접 기간 입력칸이 다시 숨겨짐');
  await page.selectOption('#as-stat-month', 'all');
  await page.selectOption('#as-stat-period', 'all');
  await page.waitForTimeout(150);

  // ================= 예약 통계 — 월 필터가 새로 생겼는지 확인 =================
  await page.click('.sidebar nav button[data-tab="prstats"]');
  await page.waitForTimeout(250);
  const prMonthOptions = await page.$$eval('#pr-stat-month option', els => els.map(e=>e.value));
  assert(prMonthOptions.includes('2026-08'), '예약 통계에도 월 필터에 이번 달(2026-08) 옵션 존재');
  await page.selectOption('#pr-stat-period', 'custom');
  await page.waitForTimeout(150);
  const prRangeVisible = await page.$eval('#pr-stat-custom-range', el => getComputedStyle(el).display !== 'none');
  assert(prRangeVisible, '예약 통계에서도 "기간 직접 설정" 선택 시 날짜 입력칸 노출');

  // ================= 단계 스트립 ↔ 목록 연결 확인 =================
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(300);
  await page.selectOption('#as-scope-select', 'all');
  await page.waitForTimeout(400);
  await page.click('#as-category-tabs button[data-cat="other"]');
  await page.waitForTimeout(300);
  const otherStrips = await page.$$eval('#as-stage-strip .stage-strip', els => els.length);
  assert(otherStrips === 1, `타사 탭 선택 시 스트립 1개만 표시 (실제 ${otherStrips})`);

  const beforeRows = await page.$$eval('#as-list .row', els => els.length);
  // 건수가 1 이상인 단계 타일을 눌러 목록이 좁혀지는지 확인
  const tiles = await page.$$('#as-stage-strip .stage-tile');
  let clicked = false;
  for(const t of tiles){
    const txt = await t.textContent();
    if(txt.includes('전체')) continue;
    const n = parseInt(txt.trim(), 10);
    if(n >= 1){ await t.click(); clicked = true; break; }
  }
  assert(clicked, '건수가 있는 단계 타일 클릭');
  await page.waitForTimeout(400);
  assert((await page.$$eval('#as-stage-strip .stage-tile.on', els => els.length)) === 1, '선택한 단계 타일이 강조 표시됨');
  const afterRows = await page.$$eval('#as-list .row', els => els.length);
  assert(afterRows >= 1 && afterRows <= beforeRows, `단계 타일 클릭 시 목록이 그 단계로 좁혀짐 (${beforeRows} → ${afterRows})`);

  // '전체' 타일로 복귀
  await page.click('#as-stage-strip .stage-tile:has-text("전체")');
  await page.waitForTimeout(400);
  const backRows = await page.$$eval('#as-list .row', els => els.length);
  assert(backRows === beforeRows, `'전체' 타일로 되돌리면 목록 복구 (${backRows})`);
  await page.click('#as-category-tabs button[data-cat="all"]');
  await page.waitForTimeout(300);

  // ================= 상태 변경이 전 직원에게 열려 있는지 확인 =================
  // (신재현 = 일반 직원 권한. 예전에는 실장만 예약 상태를 바꿀 수 있어 '문의접수'에서 멈췄음)
  await page.click('.sidebar nav button[data-tab="product"]');
  await page.waitForTimeout(250);
  await page.click('#pr-stage-strip .stage-tile:has-text("전체")');  // 단계 필터 해제
  await page.waitForTimeout(300);
  await page.click('#pr-new-btn');
  await page.waitForTimeout(200);
  await page.fill('#f-product', '테스트 상품 A');
  await page.fill('#f-cname', '상태고객');
  await page.click('#modal-body .btn-primary');
  await page.waitForTimeout(400);
  await page.click('#pr-list .row');
  await page.waitForTimeout(250);
  const prDetail0 = await page.textContent('#pr-detail');
  assert(prDetail0.includes('검토하기'), '일반 직원도 예약 "검토하기" 버튼이 보임');
  assert(await page.isVisible('#pr-detail .status-chips'), '예약 상세에 진행 상황 버튼 표시');

  // 진행 상황 버튼으로 입고완료까지 한 번에 이동
  await page.click('#pr-detail .schip:has-text("입고완료")');
  await page.waitForTimeout(400);
  const prDetail1 = await page.textContent('#pr-detail');
  assert(prDetail1.includes('입고완료'), '드롭다운으로 상태를 입고완료로 변경');
  assert(prDetail1.includes('이전 단계로'), '진행된 예약에 "이전 단계로" 버튼 표시');

  // 되돌리기 동작
  await page.click('#pr-detail button:has-text("이전 단계로")');
  await page.waitForTimeout(400);
  const prDetail2 = await page.textContent('#pr-detail');
  assert(prDetail2.includes('발주가능'), '"이전 단계로" 클릭 시 한 단계 뒤로 이동');

  // AS 쪽 상태 직접 변경
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(250);
  await page.click('#as-list .row');
  await page.waitForTimeout(250);
  assert(await page.isVisible('#as-detail .status-chips'), 'AS 상세에도 진행 상황 버튼 표시');

  // ================= 설정: 직원 권한·소속 변경이 실제로 저장되는지 =================
  // (기존에는 resv_staff 를 직접 update 해서 RLS 때문에 조용히 무시되고 있었음)
  await page.evaluate(async () => { ME.role = 'manager'; applyRoleUi(); await refreshSettings(); });
  await page.click('.sidebar nav button[data-tab="settings"]');
  await page.waitForTimeout(500);
  const staffRows = await page.$$eval('#staff-table tbody tr', els => els.length);
  assert(staffRows >= 2, `설정 직원 목록이 비어있지 않음 (실제 ${staffRows}명)`);
  const staffHtml0 = await page.textContent('#staff-table');
  assert(staffHtml0.includes('권한·매장 변경'), '직원 행에 "권한·매장 변경" 버튼 표시');

  await page.click('#staff-table tbody tr:has-text("신재현") button:has-text("권한·매장 변경")');
  await page.waitForTimeout(250);
  assert(await page.isVisible('#f-edit-role'), '권한 변경 모달 표시');
  await page.selectOption('#f-edit-role', 'admin');
  await page.selectOption('#f-edit-store', { index: 1 });
  await page.click('#modal-body .btn-primary');
  await page.waitForTimeout(450);
  const staffHtml1 = await page.textContent('#staff-table');
  assert(staffHtml1.includes('관리자'), '변경한 권한(관리자)이 목록에 반영됨');

  // ================= 단순접수 인계 절차 + 삭제 버튼 =================
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(300);
  await page.selectOption('#as-month-bar select', 'all');
  await page.waitForTimeout(300);
  await page.click('#as-new-btn');
  await page.waitForTimeout(200);
  await page.click('#f-as-cat-toggle button[data-cat="other"]');
  await page.waitForTimeout(150);
  await page.click('#f-as-cat-toggle button[data-cat="hq"]');
  await page.waitForTimeout(150);
  await page.fill('#f-as-product-search', '롤리팟');
  await page.waitForTimeout(200);
  await page.click('.as-search-item');
  await page.waitForTimeout(150);
  await page.click('#f-as-method-toggle button[data-m="단순접수"]');   // 단순접수로 접수
  await page.fill('#f-cname', '인계고객');
  await page.click('#modal-body .btn-primary');
  await page.waitForTimeout(400);

  await page.click('#as-list .row:has-text("인계고객")');
  await page.waitForTimeout(300);
  const simpleNodes = await page.$$eval('#as-detail .pipeline .node', els => els.length);
  assert(simpleNodes === 4, `단순접수 본사 제품 파이프라인 4단계 (실제 ${simpleNodes})`);
  const simpleDetail = await page.textContent('#as-detail');
  assert(simpleDetail.includes('입고·연락 대기') && simpleDetail.includes('인계 완료'),
    '단순접수 흐름에 입고·연락 대기 / 인계 완료 단계 표시');
  assert(simpleDetail.includes('접수 삭제'), 'AS 상세에 접수 삭제 버튼 표시');

  // 진행 상황이 드롭다운이 아니라 버튼으로 보여야 함
  assert(await page.isVisible('#as-detail .status-chips'), '진행 상황이 버튼(칩)으로 표시');
  assert((await page.$$eval('#as-detail .schip', els=>els.length)) >= 4, '단순접수 진행 버튼이 단계 수만큼 표시');
  assert((await page.$$eval('#as-detail .schip.on', els=>els.length)) === 1, '현재 단계 버튼이 강조 표시');

  // 입고·연락 대기까지 진행 → '연락 안 됨' 분기 확인
  await page.click('#as-detail .schip:has-text("입고·연락 대기")');
  await page.waitForTimeout(400);
  assert((await page.textContent('#as-detail')).includes('연락 안 됨'), '입고·연락 대기 단계에서 "연락 안 됨" 버튼 노출');
  await page.click('#as-detail button:has-text("연락 안 됨")');
  await page.waitForTimeout(400);
  const naDetail = await page.textContent('#as-detail');
  assert(naDetail.includes('연락됨 · 인계 완료'), '연락 두절 건에서 다시 인계 완료로 되돌릴 수 있음');
  const stripTxt = await page.textContent('#as-stage-strip');
  assert(stripTxt.includes('연락 두절'), '단순접수 스트립에 "연락 두절" 타일 표시');
  assert(stripTxt.includes('단순접수'), '스트립이 현장교체/단순접수로 나뉘어 표시');

  // 삭제
  await page.click('#as-detail button:has-text("접수 삭제")');
  await page.waitForTimeout(250);
  assert((await page.textContent('#modal-body')).includes('되돌릴 수 없습니다'), '삭제 확인 모달 표시');
  await page.click('#modal-body button:has-text("삭제합니다")');
  await page.waitForTimeout(450);
  assert(!(await page.textContent('#as-list')).includes('인계고객'), '삭제 후 목록에서 사라짐');

  // ================= 접수 정보 수정 =================
  await page.click('#as-list .row');
  await page.waitForTimeout(300);
  assert((await page.textContent('#as-detail')).includes('정보 수정'), 'AS 상세에 "정보 수정" 버튼 표시');
  await page.click('#as-detail button:has-text("정보 수정")');
  await page.waitForTimeout(300);
  assert(await page.isVisible('#e-method'), '수정 모달에 접수방식 선택 표시');
  assert(await page.isVisible('#e-date'), '수정 모달에 접수일 입력 표시');
  await page.click('#e-method button[data-m="단순접수"]');
  await page.fill('#e-cname', '수정된고객');
  await page.click('#modal-body button:has-text("저장")');
  await page.waitForTimeout(500);
  const editedDetail = await page.textContent('#as-detail');
  assert(editedDetail.includes('수정된고객'), '수정한 고객명이 상세에 반영됨');
  assert(editedDetail.includes('단순접수'), '수정한 접수방식이 반영됨');

  console.log('\n--- console/page errors captured ---');
  errors.forEach(e => console.log(e));
  console.log(errors.length ? `${errors.length} error(s) captured (see above; some may be benign 404s from stubbed CDN).` : 'no console/page errors');

  await browser.close();
  server.close();
  process.exit(process.exitCode || 0);
})();
