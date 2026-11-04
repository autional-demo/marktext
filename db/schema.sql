-- MarkText Web —— 文档存储
-- 幂等：可重复执行。

create table if not exists documents (
  id          text        primary key,
  tenant_id   text        not null,
  user_id     text        not null,
  title       text        not null default '',
  content     text        not null default '',
  rev         integer     not null default 1,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 列表查询：按租户 + 用户取最近更新的文档
create index if not exists documents_owner_idx
  on documents (tenant_id, user_id, updated_at desc);

-- 软删除过滤
create index if not exists documents_owner_live_idx
  on documents (tenant_id, user_id)
  where deleted_at is null;
