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
  assert(await page.isVisible('#view-as.active'), '로그인 직후 첫 화면 = AS 접수(접수 화면)');
  assert(await page.isVisible('#as-new-btn'), '접수 화면에 "+ 새 AS 접수" 버튼 바로 노출');
  const firstMenu = await page.$eval('.sidebar nav button', el => el.dataset.tab);
  assert(firstMenu === 'as', `사이드바 첫 메뉴 = AS 접수 (실제 ${firstMenu})`);

  // ---- 처리 현황판은 사이드바에서 들어가서 확인 ----
  await page.click('.sidebar nav button[data-tab="board"]');
  await page.waitForTimeout(400);
  assert(await page.isVisible('#view-board.active'), '사이드바에서 처리 현황판 진입');
  assert(await page.isVisible('#board-hq'), '본사 제품 단계 보드 표시');
  assert(await page.isVisible('#board-other'), '타사 제품 단계 보드 표시');
  assert(await page.isVisible('#board-pr'), '상품 예약 단계 보드 표시');
  const hqCols = await page.$$eval('#board-hq .bcol', els => els.length);
  assert(hqCols === 2, `본사 제품 보드 칸 2개 (실제 ${hqCols})`);
  const otherCols = await page.$$eval('#board-other .bcol', els => els.length);
  assert(otherCols === 6, `타사 제품 보드 칸 6개 (실제 ${otherCols})`);
  const prCols = await page.$$eval('#board-pr .bcol', els => els.length);
  assert(prCols === 5, `상품 예약 보드 칸 5개 (실제 ${prCols})`);
  const kpiCount = await page.$$eval('#board-kpi .k', els => els.length);
  assert(kpiCount === 4, `현황판 요약 카드 4개 (실제 ${kpiCount})`);

  // ---- 보는 범위(매장) 드롭다운 ----
  const scopeOpts = await page.$$eval('#board-scope-select option', els => els.map(e => e.value));
  assert(scopeOpts[0] === 'all' && scopeOpts.length === 3, `범위 선택에 전체 매장 + 매장 2곳 (실제 ${scopeOpts.length}개)`);
  await page.selectOption('#board-scope-select', '2');
  await page.waitForTimeout(300);
  assert((await page.textContent('#board-scope-name')).trim() === '로데오점', '범위를 로데오점으로 바꾸면 현황판 라벨 갱신');
  assert((await page.textContent('#as-current-store-name')).trim() === '로데오점', 'AS 화면 범위 라벨도 같이 갱신');

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

  // ================= 현황판 ↔ 목록 연결 확인 =================
  await page.click('.sidebar nav button[data-tab="board"]');
  await page.waitForTimeout(400);
  assert(await page.isVisible('#view-board.active'), '사이드바에서 처리 현황판으로 복귀');

  // 전체 매장 범위로 바꾸면 앞서 등록한 건들이 모두 보드에 잡혀야 함
  await page.selectOption('#board-scope-select', 'all');
  await page.waitForTimeout(400);
  assert((await page.textContent('#board-scope-name')).trim() === '전체 매장', '범위를 전체 매장으로 전환');
  const otherTot = await page.textContent('#other-tot');
  assert(/[1-9]/.test(otherTot), `타사 제품 보드 합계에 건수 표시 (실제 ${otherTot})`);

  // 타사 보드에서 실제 건이 있는 칸을 눌러 그 단계 목록으로 진입
  const targetCol = await page.$('#board-other .bcol:has(.bcard)');
  assert(!!targetCol, '타사 보드에 카드가 있는 칸 존재');
  await targetCol.click();
  await page.waitForTimeout(500);
  assert(await page.isVisible('#view-as.active'), '보드 칸 클릭 → AS 접수 화면으로 이동');
  assert(await page.isVisible('#as-stage-banner.on'), '단계만 보는 중임을 알리는 안내 배너 표시');
  const bannerTxt = await page.textContent('#as-stage-banner');
  assert(bannerTxt.includes('단계만 보는 중'), '배너에 단계 필터 안내 문구 표시');
  const stagedRows = await page.$$eval('#as-list .row', els => els.length);
  assert(stagedRows >= 1, `단계 필터 적용된 목록에 항목 표시 (실제 ${stagedRows}건)`);

  // 배너의 해제 버튼으로 전체 보기 복귀
  await page.click('#as-stage-banner button');
  await page.waitForTimeout(400);
  assert(!(await page.isVisible('#as-stage-banner.on')), '단계 해제 시 배너 사라짐');
  const allRows = await page.$$eval('#as-list .row', els => els.length);
  assert(allRows >= stagedRows, `단계 해제 후 목록이 더 넓어짐 (${stagedRows} → ${allRows})`);

  // 전체 매장 범위에서는 목록 각 줄에 매장명이 굵게 표시됨
  const asListHtml = await page.innerHTML('#as-list');
  assert(asListHtml.includes('<b>'), '전체 매장 범위일 때 목록에 매장명 강조 표시');

  // 예약 보드 칸 클릭 → 상품 예약 화면 + 상태 필터 적용
  await page.click('.sidebar nav button[data-tab="board"]');
  await page.waitForTimeout(350);
  await page.click('#board-pr .bcol');
  await page.waitForTimeout(400);
  assert(await page.isVisible('#view-product.active'), '예약 보드 칸 클릭 → 상품 예약 화면으로 이동');
  assert((await page.$eval('#pr-status-filter', el => el.value)) === 'requested', '예약 상태 필터가 그 단계로 지정됨');

  console.log('\n--- console/page errors captured ---');
  errors.forEach(e => console.log(e));
  console.log(errors.length ? `${errors.length} error(s) captured (see above; some may be benign 404s from stubbed CDN).` : 'no console/page errors');

  await browser.close();
  server.close();
  process.exit(process.exitCode || 0);
})();
