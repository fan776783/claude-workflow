import assert from 'node:assert/strict';

const ctx = (x) => x ? `[${x}] ` : '';

export const expect2xx = (r, c = '') => {
  if (r.error) throw new Error(`${ctx(c)}网络错误: ${r.error.message}`);
  assert.ok(r.status >= 200 && r.status < 300, `${ctx(c)}期望 2xx 得到 ${r.status}`);
};
export const expect4xx = (r, c = '') =>
  assert.ok(r.status >= 400 && r.status < 500, `${ctx(c)}期望 4xx 得到 ${r.status}`);
export const expectNot5xx = (r, c = '') =>
  assert.ok(r.status < 500, `${ctx(c)}不应 5xx 得到 ${r.status}`);
export const expectBizOk = (r, c = '') => {
  expect2xx(r, c);
  if (r.data?.code !== undefined)
    assert.equal(r.data.code, 0, `${ctx(c)}业务 code=${r.data.code} msg=${r.data.msg}`);
};
export const expectNotLogin = (r, c = '') => {
  const m = String(r.data?.msg || '');
  assert.ok(r.status === 401 || /not login|未登录|unauthor/i.test(m),
    `${ctx(c)}期望未登录 实得 status=${r.status} msg=${m}`);
};
export const expectBizCode = (r, expected, c = '') => {
  expectNot5xx(r, c);
  assert.equal(String(r.data?.code), String(expected),
    `${ctx(c)}期望 code=${expected} 得到 code=${r.data?.code} msg=${r.data?.msg}`);
};
export const expectHasFields = (data, fields, c = '') => {
  for (const f of fields) assert.ok(data?.[f] !== undefined, `${ctx(c)}字段 ${f} 缺失`);
};

// 模块级「当前测试名」,client.mjs 读这个把每条请求标到所属用例
export const runnerContext = { suite: '', test: '' };

export class Runner {
  constructor(title) {
    this.title = title;
    this.cases = [];
    runnerContext.suite = title;
  }
  test(name, fn) { this.cases.push({ name, fn }); }
  skip(name) { this.cases.push({ name, fn: null, skipped: true }); }
  async run() {
    console.log(`\n=== ${this.title} ===`);
    runnerContext.suite = this.title;
    let passed = 0, failed = 0, skipped = 0;
    for (const c of this.cases) {
      runnerContext.test = c.name;
      if (c.skipped) { console.log(`  ⊘ ${c.name} (skipped)`); skipped++; continue; }
      try { await c.fn(); console.log(`  ✅ ${c.name}`); passed++; }
      catch (e) { console.error(`  ❌ ${c.name}\n     ${e.message}`); failed++; }
    }
    runnerContext.test = '';
    console.log(`${this.title}: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed ? 1 : 0);
  }
}
