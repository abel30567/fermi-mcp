---
name: aws-cdk-discipline
description: AWS infrastructure policy for fermi-agentcore - all changes through CDK committed to main, Fermi AWS access is read-only verification
keywords: ["aws", "cdk", "infrastructure", "agentcore", "iac", "deploy", "sigv4", "secrets"]
allowed_tools: ["execute", "fetch_url", "secret_resolve"]
---
# AWS CDK-only discipline (fermi-agentcore)

## The policy (non-negotiable)
ALL AWS infrastructure changes for fermi-agentcore go through CDK: edit the
constructs, commit, push to `main` → CI (typecheck/lint/test/synth) →
`cdk deploy --all` to ca-central-1 via the OIDC deploy role. Creating, updating
or deleting AWS resources directly (console or API) is a LAST RESORT only after
confirming no CDK path exists. Applies to IAM roles, DynamoDB tables, Lambdas,
Gateway targets — everything.

## Fermi's AWS access is READ-ONLY
SigV4-signed verification calls only, using `{{secret:AWS_ACCESS_KEY_ID}}` +
`{{secret:AWS_SECRET_ACCESS_KEY}}` (allowed_hosts: *.amazonaws.com). Use them
to confirm deployed state (GetGateway, ListGatewayTargets,
DescribeLogGroups, ...) — never to mutate. For bedrock-agentcore control-plane
calls, sign with service name `bedrock-agentcore` (NOT
`bedrock-agentcore-control`) against host
`bedrock-agentcore-control.{region}.amazonaws.com`.

## Secrets
Runtime secrets for AgentCore go through the AgentCore secrets-set tool (its
own store), never by writing AWS Secrets Manager directly.

## Repo facts
- Repo: your-org/your-repo, region ca-central-1.
- 6 stacks: Identity, Gateway, Memory, Storage, Compute, Observability.
- When live state and CDK source disagree, fix the CDK to match intent and
  deploy; verify with `cdk diff` showing zero unexpected changes.
- Claude.ai loads only ~30 of the gateway's tools (client cap, issue #13) —
  consolidate tools (op params) rather than adding more.
