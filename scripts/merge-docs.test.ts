import test from "node:test";
import assert from "node:assert/strict";

import { hashText, type Doc } from "../lib/docs";
import { isDirty, mergeDocs, type ServerDocMeta } from "../lib/merge";

function doc(overrides: Partial<Doc> & { id: string }): Doc {
  const title = overrides.title ?? "标题";
  const content = overrides.content ?? "正文";
  return {
    title,
    content,
    rev: 1,
    updatedAt: 1_700_000_000_000,
    loaded: true,
    synced: { title: hashText(title), content: hashText(content) },
    ...overrides,
  };
}

function meta(overrides: Partial<ServerDocMeta> & { id: string }): ServerDocMeta {
  return {
    title: "标题",
    rev: 1,
    updatedAt: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

test("rev 相同 → 本地对象原样保留，且不算变化", () => {
  const local = [doc({ id: "a" })];
  const out = mergeDocs(local, [meta({ id: "a" })]);
  assert.equal(out.docs[0], local[0], "必须是同一个引用，才能避免无谓重渲染");
  assert.equal(out.changed, false);
  assert.deepEqual(out.pendingUploadIds, []);
});

test("云端更新、本地干净 → 只标记 remoteRev，正文不动（后台静默换）", () => {
  const local = [doc({ id: "a", content: "本地正文" })];
  const out = mergeDocs(local, [meta({ id: "a", rev: 2, title: "云端新标题" })]);
  const merged = out.docs[0];
  assert.equal(merged.content, "本地正文", "本地优先：正文不能被清空");
  assert.equal(merged.rev, 1, "未拉取前不能谎称已是新版");
  assert.equal(merged.remoteRev, 2);
  assert.equal(merged.remoteTitle, "云端新标题");
  assert.notEqual(merged.remoteConflict, true, "干净的本地不该被当成冲突");
  assert.equal(out.changed, true);
  assert.deepEqual(out.conflictingIds, []);
});

test("云端更新 + 本地有未上传改动 → 记为冲突，内容仍以本地为准", () => {
  const local = [doc({ id: "a", content: "本地改过的正文" })];
  // 指纹还停在改之前的内容 → 说明有未上传改动
  local[0].synced = { title: hashText("标题"), content: hashText("正文") };
  const out = mergeDocs(local, [meta({ id: "a", rev: 3 })]);
  assert.deepEqual(out.conflictingIds, ["a"]);
  assert.equal(out.docs[0].content, "本地改过的正文");
  assert.equal(out.docs[0].remoteRev, 3);
  assert.equal(out.docs[0].remoteConflict, true, "真冲突要显式标记，交给用户");
});

test("本地没正文（loaded=false）→ 直接采用云端元数据，等按需拉取", () => {
  const local = [doc({ id: "a", loaded: false, content: "" })];
  const out = mergeDocs(local, [meta({ id: "a", rev: 5, title: "新标题" })]);
  const merged = out.docs[0];
  assert.equal(merged.rev, 5);
  assert.equal(merged.title, "新标题");
  assert.equal(merged.loaded, false);
  assert.equal(merged.remoteRev, undefined);
});

test("本机新建（rev=0）且云端还没有 → 保留并排队补传", () => {
  const local = [doc({ id: "new", rev: 0, loaded: true })];
  const out = mergeDocs(local, []);
  assert.equal(out.docs.length, 1);
  assert.deepEqual(out.pendingUploadIds, ["new"]);
});

test("云端已删除（rev>0 但列表没有）→ 不再复活", () => {
  const local = [doc({ id: "gone", rev: 4 })];
  const out = mergeDocs(local, []);
  assert.equal(out.docs.length, 0);
  assert.equal(out.changed, true);
});

test("本地干净但有未上传改动指纹 → 排入补传", () => {
  const local = [doc({ id: "a", content: "离线时改的" })];
  // synced 记录的是旧内容 → 指纹不匹配
  local[0].synced = { title: hashText("标题"), content: hashText("旧正文") };
  const out = mergeDocs(local, [meta({ id: "a" })]);
  assert.deepEqual(out.pendingUploadIds, ["a"]);
  assert.equal(isDirty(local[0]), true);
});

test("云端新增文档 → 插到最前面并等待拉取正文", () => {
  const local = [doc({ id: "existing" })];
  const out = mergeDocs(local, [
    meta({ id: "remote-new", rev: 2, title: "远端新文档" }),
    meta({ id: "existing" }),
  ]);
  assert.equal(out.docs[0].id, "remote-new");
  assert.equal(out.docs[0].loaded, false);
  assert.equal(out.docs[1].id, "existing");
});

test("本地顺序保持不变（同步后侧栏不重排）", () => {
  const local = [doc({ id: "b" }), doc({ id: "a" })];
  const out = mergeDocs(local, [meta({ id: "a" }), meta({ id: "b" })]);
  assert.deepEqual(
    out.docs.map((d) => d.id),
    ["b", "a"],
  );
});

test("服务端 rev 意外更低 → 保守保留本地", () => {
  const local = [doc({ id: "a", rev: 7 })];
  const out = mergeDocs(local, [meta({ id: "a", rev: 6 })]);
  assert.equal(out.docs[0].rev, 7);
  assert.equal(out.docs[0].remoteRev, undefined);
});
