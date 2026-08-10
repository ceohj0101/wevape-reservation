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
  assert(await page.isVisible('#home-grid'), '로그인 성공 후 매장 선택 홈 화면 표시');
  const storeTileCount = await page.$$eval('.store-tile', els => els.length);
  assert(storeTileCount === 2, `홈 화면에 매장 타일 2개 표시 (실제 ${storeTileCount})`);

  // ---- 매장 타일 클릭 → 그 매장 화면으로 진입 ----
  await page.click('.store-tile');
  await page.waitForTimeout(300);
  assert(await page.isVisible('#app'), '매장 선택 후 앱 화면 표시');
  assert(!(await page.isVisible('#home-grid')), '매장 선택 후 홈 화면은 숨겨짐');
  const currentStoreLabel = await page.textContent('#as-current-store-name');
  assert(currentStoreLabel.trim().length > 0, '현재 매장 표시 바에 매장명 노출');

  // ---- Go to AS tab ----
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#view-as.active'), 'AS 접수 탭 활성화');

  // ================= Case 1: 본사 제품 (그래피티C 배터리) =================
  await page.click('#as-new-btn');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#f-as-product-area'), '등록 모달의 제품 영역 표시');

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

  // ================= "매장 변경" → 홈 화면으로 복귀 확인 =================
  await page.click('.sidebar nav button[data-tab="as"]');
  await page.waitForTimeout(150);
  await page.click('#view-as .change-store-btn');
  await page.waitForTimeout(250);
  assert(await page.isVisible('#home-grid'), '"매장 변경" 클릭 시 홈 화면으로 복귀');
  assert(!(await page.isVisible('#app')), '"매장 변경" 클릭 시 앱 화면은 숨겨짐');
  // 다른 매장으로 다시 들어가서 이후 흐름에 지장 없는지 확인
  await page.click('.store-tile');
  await page.waitForTimeout(250);
  assert(await page.isVisible('#app'), '다른 매장 재선택 후 앱 화면 정상 표시');

  console.log('\n--- console/page errors captured ---');
  errors.forEach(e => console.log(e));
  console.log(errors.length ? `${errors.length} error(s) captured (see above; some may be benign 404s from stubbed CDN).` : 'no console/page errors');

  await browser.close();
  server.close();
  process.exit(process.exitCode || 0);
})();
