/**
 * 启动时的会话裁决（纯函数，便于单测）。
 *
 * 背景：认证校验要打一次网络，慢的时候首屏要等一个 RTT。做法是本地存一份
 * 「上次登录成功是谁」的快照，先用它渲染工作区，再把校验放到后台。
 *
 * 关键安全约束：只有**暂时性**失败（断网 / 服务 5xx / 配置问题）才允许沿用
 * 乐观会话；凭证过期或被吊销必须立刻清掉，不能靠快照继续停留在工作区。
 */

export type BootIssue = "expired" | "revoked" | "transient" | "config";

export type BootDecision =
  | { kind: "authenticated" }
  | { kind: "keep-optimistic"; issue: BootIssue }
  | { kind: "unauthenticated"; issue: BootIssue };

export function decideBoot(input: {
  authenticated: boolean;
  issue: BootIssue | null;
  hasSnapshot: boolean;
}): BootDecision {
  if (input.authenticated) return { kind: "authenticated" };

  const issue = input.issue;
  const recoverable = issue === "transient" || issue === "config";
  if (recoverable && input.hasSnapshot) {
    return { kind: "keep-optimistic", issue };
  }

  return { kind: "unauthenticated", issue: issue ?? "expired" };
}
