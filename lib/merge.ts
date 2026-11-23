/**
 * 本地优先的列表合并（纯函数，便于单测）。
 *
 * 旧的合并方式：以服务端列表为准重建数组，rev 不一致就把本地正文清空再下载。
 * 结果是「打开就要联网」：一有远程变动，本地内容立刻不可用。
 *
 * 现在的规则：
 *   1. 云端没变（rev 相同）→ 本地对象原样保留，不碰内容、不触发重渲染；
 *   2. 云端更新、本地干净 → 标记 remoteRev，由后台静默拉取替换，不提示用户；
 *   3. 云端更新、本地也有未上传改动 → 标记 remoteConflict，交给用户裁决，绝不静默覆盖；
 *   4. 云端没有、本地 rev=0 → 本机新建，排队补传；
 *   5. 云端没有、本地 rev>0 → 别的设备删了，不复活（与旧行为一致）。
 *
 * 顺序也按本地优先：已有序不变（侧栏不会在同步后突然重排），新文档插到最前面。
 */

import { hashText, type Doc } from "./docs";

export interface ServerDocMeta {
  id: string;
  title: string;
  rev: number;
  updatedAt: string;
}

export interface MergeOutcome {
  docs: Doc[];
  /** 本机有未上传改动、云端没有更新 → 需要补传 */
  pendingUploadIds: string[];
  /** 云端也更新了、本地也有改动 → 真冲突，等用户选择 */
  conflictingIds: string[];
  /** 列表是否真的变了（没变就不要 setState，避免无谓重渲染） */
  changed: boolean;
}

function toMillis(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** 本地是否有尚未上传到云端的改动（靠字段指纹判断，重启后依然有效）。 */
export function isDirty(doc: Doc): boolean {
  if (!doc.synced || doc.loaded === false) return false;
  return (
    doc.synced.title !== hashText(doc.title) ||
    doc.synced.content !== hashText(doc.content)
  );
}

export function mergeDocs(local: Doc[], server: ServerDocMeta[]): MergeOutcome {
  const serverById = new Map(server.map((meta) => [meta.id, meta]));
  const localIds = new Set(local.map((doc) => doc.id));

  const pendingUploadIds: string[] = [];
  const conflictingIds: string[] = [];
  const kept: Doc[] = [];

  for (const doc of local) {
    const remote = serverById.get(doc.id);

    // 云端没有这篇
    if (!remote) {
      if (doc.rev === 0) {
        kept.push(doc);
        pendingUploadIds.push(doc.id);
      }
      // rev > 0：说明在别的设备被删除，不再复活
      continue;
    }

    // 云端没变：原样保留
    if (remote.rev === doc.rev) {
      if (isDirty(doc)) pendingUploadIds.push(doc.id);
      kept.push(doc);
      continue;
    }

    // 服务端 rev 只增不减；万一更低，保守保留本地
    if (remote.rev < doc.rev) {
      kept.push(doc);
      continue;
    }

    // 云端更新了
    if (isDirty(doc)) {
      // 本地也有改动：保留本地内容，标记「真冲突」，交给用户
      conflictingIds.push(doc.id);
      kept.push({
        ...doc,
        remoteRev: remote.rev,
        remoteTitle: remote.title,
        remoteConflict: true,
      });
      continue;
    }

    if (doc.loaded === false) {
      // 本地本来就没有正文：直接采用云端元数据，正文按需拉
      kept.push({
        ...doc,
        title: remote.title,
        rev: remote.rev,
        updatedAt: toMillis(remote.updatedAt),
        remoteRev: undefined,
        remoteTitle: undefined,
        remoteConflict: undefined,
      });
      continue;
    }

    // 本地干净、有正文：标记待静默刷新（不提示、不打断）
    kept.push({
      ...doc,
      remoteRev: remote.rev,
      remoteTitle: remote.title,
      remoteConflict: undefined,
    });
  }

  // 云端有、本机没有：按云端顺序插到最前面
  const added: Doc[] = server
    .filter((meta) => !localIds.has(meta.id))
    .map((meta) => ({
      id: meta.id,
      title: meta.title,
      content: "",
      rev: meta.rev,
      updatedAt: toMillis(meta.updatedAt),
      loaded: false,
    }));

  const docs = [...added, ...kept];
  const changed =
    docs.length !== local.length || docs.some((doc, index) => doc !== local[index]);

  return { docs, pendingUploadIds, conflictingIds, changed };
}
