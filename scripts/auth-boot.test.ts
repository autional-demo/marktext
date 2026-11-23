import test from "node:test";
import assert from "node:assert/strict";

import { decideBoot } from "../lib/auth-boot";

test("会话有效 → 直接进工作区", () => {
  assert.deepEqual(
    decideBoot({ authenticated: true, issue: null, hasSnapshot: false }),
    { kind: "authenticated" },
  );
});

test("有效会话时忽略遗留的错误分类", () => {
  assert.deepEqual(
    decideBoot({ authenticated: true, issue: "transient", hasSnapshot: true }),
    { kind: "authenticated" },
  );
});

test("断网 + 有快照 → 沿用乐观会话（离线可继续写）", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: "transient", hasSnapshot: true }),
    { kind: "keep-optimistic", issue: "transient" },
  );
});

test("配置异常 + 有快照 → 保留界面但标记问题", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: "config", hasSnapshot: true }),
    { kind: "keep-optimistic", issue: "config" },
  );
});

test("断网但没有快照 → 不能伪造会话", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: "transient", hasSnapshot: false }),
    { kind: "unauthenticated", issue: "transient" },
  );
});

test("凭证过期 + 有快照 → 必须清掉（不能靠快照续命）", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: "expired", hasSnapshot: true }),
    { kind: "unauthenticated", issue: "expired" },
  );
});

test("凭证吊销 + 有快照 → 必须清掉", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: "revoked", hasSnapshot: true }),
    { kind: "unauthenticated", issue: "revoked" },
  );
});

test("没有明确错误时按过期处理", () => {
  assert.deepEqual(
    decideBoot({ authenticated: false, issue: null, hasSnapshot: true }),
    { kind: "unauthenticated", issue: "expired" },
  );
});
