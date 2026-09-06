import type { CatalogCreateProposalRequest, ParameterCatalogGovernanceRepository } from "../ports/ParameterCatalogGovernanceRepository";

/** Shared executable semantics; no test framework or server implementation imports. */
export type ProposalContractHarness = {
  governance: ParameterCatalogGovernanceRepository;
  releaseId: string;
  authorId: string;
  definitionId: string;
  revisionId: string;
  setActor?: (actor: "author" | "other-author" | "reviewer" | "self-reviewer" | "guest" | "inactive" | "other-org") => Promise<void>;
  businessEvidence?: () => Promise<unknown>;
};

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  check(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), `${message}: ${JSON.stringify(actual)}`);
}

async function conflict(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    const failure = error as { code?: string; details?: { reason?: string } };
    check(failure.code === "CONFLICT" && failure.details?.reason === "revision-conflict", "expected revision-conflict");
    return;
  }
  throw new Error("expected revision-conflict, operation succeeded");
}

async function failureCode(operation: Promise<unknown>, code: string) {
  try { await operation; }
  catch (error) { check((error as { code?: string }).code === code, `expected ${code}`); return; }
  throw new Error(`expected ${code}, operation succeeded`);
}

const createBody = (h: ProposalContractHarness) => ({
  base: { catalogReleaseId: h.releaseId, definitionId: h.definitionId, definitionRevisionId: h.revisionId },
  requestedChange: { kind: "revise-definition", documentation: "Contract vector retained content" },
  reason: "R2 proposal contract",
  evidenceRefs: ["evidence:r2-prop"]
});

const context = (h: ProposalContractHarness, idempotencyKey: string, ifMatch: string) => ({
  catalogReleaseId: h.releaseId, idempotencyKey, ifMatch
});

const create = (h: ProposalContractHarness, key: string) => h.governance.createProposal(createBody(h), {
  catalogReleaseId: h.releaseId, idempotencyKey: key
});

export const proposalContractVectors = [
  ...(["accept", "reject"] as const).flatMap((operation) => [
    { name: "empty", value: "" },
    { name: "spaces only", value: "   " },
    { name: "leading whitespace", value: " padded" },
    { name: "trailing whitespace", value: "padded " },
    { name: "NUL", value: "bad\u0000value" },
    { name: "newline", value: "bad\nvalue" },
    { name: "C0 upper bound", value: "bad\u001fvalue" },
    { name: "DEL", value: "bad\u007fvalue" },
    { name: "C1 lower bound", value: "bad\u0080value" },
    { name: "C1 upper bound", value: "bad\u009fvalue" },
  ].map((invalid, index) => ({
    id: `R2-REV-04-${operation}-${index + 1}`,
    name: `${operation} rejects ${invalid.name} without effects or reserving the key`,
    async run(h: ProposalContractHarness) {
      check(Boolean(h.setActor), "actor-switch harness is required");
      const key = `review-input-${operation}-${index}`;
      const draft = await create(h, `${key}-create`);
      const submitted = await h.governance.submitProposal(draft.item.id, {}, context(h, `${key}-submit`, draft.item.etag));
      await h.setActor!("reviewer");
      const write = context(h, key, submitted.item.etag);
      const before = await h.governance.getProposal(draft.item.id);
      const evidence = await h.businessEvidence?.();
      const review = (value: string) => operation === "accept"
        ? h.governance.acceptProposal(draft.item.id, { repositoryReference: value }, write)
        : h.governance.rejectProposal(draft.item.id, { reason: value }, write);
      try {
        await review(invalid.value);
        throw new Error("invalid review unexpectedly succeeded");
      } catch (error) {
        const failure = error as { code?: string; details?: { field?: string; retryable?: boolean } };
        equal(failure.code, "VALIDATION_FAILED", "invalid review error code");
        equal(failure.details?.field, operation === "accept" ? "repositoryReference" : "reason", "invalid review field");
        equal(failure.details?.retryable, false, "invalid review is not retryable");
      }
      equal(await h.governance.getProposal(draft.item.id), before, "invalid review preserves status, content, version, ETag and intent reference");
      if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "invalid review has no business, success audit or committed dedupe effects");
      const valid = operation === "accept" ? "refs/heads/review-input" : "Requires a documented correction";
      const corrected = await review(valid);
      equal(corrected.item.status, operation === "accept" ? "accepted" : "rejected", "corrected original key succeeds");
      equal(corrected.item.version, submitted.item.version + 1, "only the valid review advances version once");
      check(corrected.item.etag !== submitted.item.etag, "valid review produces a new ETag");
      check(operation === "accept" ? Boolean(corrected.item.publicationIntentRef) : !corrected.item.publicationIntentRef, "only accept produces an intent reference");
      const committedEvidence = await h.businessEvidence?.();
      equal(await review(valid), corrected, "corrected request replays original ETag and first snapshot");
      if (h.businessEvidence) equal(await h.businessEvidence(), committedEvidence, "valid replay has no additional effects");
    }
  }))),
  ...[
    { name: "body release differs from the current header", edit: (body: CatalogCreateProposalRequest) => { body.base.catalogReleaseId = "crel_not_installed"; }, code: "CONFLICT", reason: "proposal-stale" },
    { name: "Definition lacks revision", edit: (body: CatalogCreateProposalRequest) => { delete body.base.definitionRevisionId; }, code: "VALIDATION_FAILED", field: "base.definitionRevisionId" },
    { name: "revision lacks Definition", edit: (body: CatalogCreateProposalRequest) => { delete body.base.definitionId; }, code: "VALIDATION_FAILED", field: "base.definitionId" },
    { name: "revision belongs to another Definition", edit: (body: CatalogCreateProposalRequest) => { body.base.definitionId = "pdef_other_owner"; }, code: "VALIDATION_FAILED", field: "baseDefinitionId" },
    { name: "revision is not installed", edit: (body: CatalogCreateProposalRequest) => { body.base.definitionRevisionId = "drev_not_installed"; }, code: "VALIDATION_FAILED", field: "baseDefinitionRevisionId" },
    { name: "empty reason", edit: (body: CatalogCreateProposalRequest) => { body.reason = ""; }, code: "VALIDATION_FAILED", field: "reason" },
    { name: "whitespace reason", edit: (body: CatalogCreateProposalRequest) => { body.reason = " "; }, code: "VALIDATION_FAILED", field: "reason" },
    { name: "control character evidence", edit: (body: CatalogCreateProposalRequest) => { body.evidenceRefs = ["evidence:\ninvalid"]; }, code: "VALIDATION_FAILED", field: "evidenceRefs" },
    { name: "empty body release", edit: (body: CatalogCreateProposalRequest) => { body.base.catalogReleaseId = ""; }, code: "VALIDATION_FAILED", field: "claimedBaseReleaseId" },
  ].map((invalid, index) => ({
    id: `R2-REV-01-${index + 1}`,
    name: `invalid create ${invalid.name} has no effects and corrected original key succeeds`,
    async run(h: ProposalContractHarness) {
      const body: CatalogCreateProposalRequest = createBody(h);
      invalid.edit(body);
      const write = { catalogReleaseId: h.releaseId, idempotencyKey: `review-invalid-${index}` };
      const before = await h.governance.listProposals();
      const evidence = await h.businessEvidence?.();
      try {
        await h.governance.createProposal(body, write);
        throw new Error("invalid create unexpectedly succeeded");
      } catch (error) {
        const failure = error as { code?: string; details?: { reason?: string; field?: string } };
        equal(failure.code, invalid.code, "invalid create error code");
        if (invalid.reason) equal(failure.details?.reason, invalid.reason, "invalid create reason");
        if (invalid.field) equal(failure.details?.field, invalid.field, "invalid create field");
      }
      equal(await h.governance.listProposals(), before, "invalid create leaves proposal collection unchanged");
      if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "invalid create has no business, success audit or committed dedupe effects");
      const corrected = await h.governance.createProposal(createBody(h), write);
      check(corrected.item.status === "draft", "failed create does not reserve the key");
    }
  })),
  ...["", " ", " padded-kind ", "bad\nkind", "revise-definition"].map((kind, index) => ({
    id: `R2-REV-02-${index + 1}`,
    name: `kind representation ${JSON.stringify(kind)} is identical in mutation, get, list and replay`,
    async run(h: ProposalContractHarness) {
      const body = { ...createBody(h), requestedChange: { kind, documentation: "Retain all content", nested: { amount: 7 } } };
      const write = { catalogReleaseId: h.releaseId, idempotencyKey: `review-kind-${index}` };
      const created = await h.governance.createProposal(body, write);
      const expected = { ...body.requestedChange, kind: index === 4 ? "revise-definition" : "definition-proposal" };
      equal(created.item.requestedChange, expected, "mutation applies historical output normalization without losing fields");
      equal((await h.governance.getProposal(created.item.id)).item.requestedChange, expected, "get has same content");
      equal((await h.governance.listProposals({ limit: 100 })).items.find((item) => item.id === created.item.id)?.requestedChange, expected, "list has same content");
      const evidence = await h.businessEvidence?.();
      equal(await h.governance.createProposal(body, write), created, "replay has same normalized snapshot");
      if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "replay does not create effects");
      if (index !== 4) await conflict(h.governance.createProposal({ ...body, requestedChange: { ...body.requestedChange, kind: "definition-proposal" } }, write));
    }
  })),
  {
    id: "R2-REV-03",
    name: "omitted and empty evidence are identical create semantics but changed evidence conflicts",
    async run(h: ProposalContractHarness) {
      const body: CatalogCreateProposalRequest = createBody(h);
      delete body.evidenceRefs;
      // Both absent base IDs are a legal new Definition proposal.
      delete body.base.definitionId;
      delete body.base.definitionRevisionId;
      const write = { catalogReleaseId: h.releaseId, idempotencyKey: "review-evidence-default" };
      const first = await h.governance.createProposal(body, write);
      const evidence = await h.businessEvidence?.();
      equal(await h.governance.createProposal({ ...body, evidenceRefs: [] }, write), first, "defaulted evidence replays original response and ETag");
      await conflict(h.governance.createProposal({ ...body, evidenceRefs: ["evidence:changed"] }, write));
      if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "equivalent replay and conflict have no extra effects");
    }
  },
  {
    id: "R2-PROP-01",
    name: "create and submit preserve identity, base, content and author",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t01-create");
      check(draft.item.status === "draft", "create must produce draft");
      equal(draft.item.base, createBody(h).base, "create preserves base");
      equal(draft.item.requestedChange, createBody(h).requestedChange, "create preserves requested content");
      check(draft.item.submittedByPersonId === h.authorId, "create preserves author");
      const submitted = await h.governance.submitProposal(draft.item.id, {}, context(h, "t01-submit", draft.item.etag));
      check(submitted.item.id === draft.item.id && submitted.item.status === "submitted", "submit preserves identity");
      equal(submitted.item.base, draft.item.base, "submit preserves base");
      equal(submitted.item.requestedChange, draft.item.requestedChange, "submit preserves content");
      check(submitted.item.etag !== draft.item.etag, "submit advances ETag");
    }
  },
  {
    id: "R2-PROP-02",
    name: "committed submit replays original key and original ETag",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t02-create");
      const write = context(h, "t02-submit", draft.item.etag);
      const first = await h.governance.submitProposal(draft.item.id, {}, write);
      // Awaited first response establishes a completed write; discard it as the caller would.
      check((await h.governance.getProposal(draft.item.id)).item.status === "submitted", "commit observed before replay");
      const evidence = await h.businessEvidence?.();
      const replay = await h.governance.submitProposal(draft.item.id, {}, write);
      equal(replay, first, "exact replay returns original snapshot");
      if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "replay leaves all recorded business and success-audit evidence unchanged");
    }
  },
  {
    id: "R2-PROP-03",
    name: "same key with changed conditional context cannot reuse success",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t03-create");
      const first = await h.governance.submitProposal(draft.item.id, {}, context(h, "t03-submit", draft.item.etag));
      await conflict(h.governance.submitProposal(draft.item.id, {}, context(h, "t03-submit", first.item.etag)));
    }
  },
  {
    id: "R2-PROP-03B",
    name: "changed submit reason with same key is different request semantics",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t03b-create");
      const write = context(h, "t03b-submit", draft.item.etag);
      await h.governance.submitProposal(draft.item.id, { reason: "first reason" }, write);
      await conflict(h.governance.submitProposal(draft.item.id, { reason: "changed reason" }, write));
    }
  },
  {
    id: "R2-PROP-03C",
    name: "an ETag from another Proposal is not a valid precondition",
    async run(h: ProposalContractHarness) {
      const first = await create(h, "t03c-first");
      const second = await create(h, "t03c-second");
      await conflict(h.governance.submitProposal(second.item.id, {}, context(h, "t03c-submit", first.item.etag)));
    }
  },
  {
    id: "R2-PROP-03D",
    name: "same key is isolated across operations and targets, including colon-bearing keys",
    async run(h: ProposalContractHarness) {
      const first = await create(h, "t03d:shared:key");
      const second = await create(h, "t03d:second:key");
      const firstSubmitted = await h.governance.submitProposal(first.item.id, {}, context(h, "t03d:shared:key", first.item.etag));
      const secondSubmitted = await h.governance.submitProposal(second.item.id, {}, context(h, "t03d:shared:key", second.item.etag));
      check(firstSubmitted.item.id !== secondSubmitted.item.id, "target namespaces do not share responses");
      const withdrawn = await h.governance.withdrawProposal(first.item.id, {}, context(h, "t03d:shared:key", firstSubmitted.item.etag));
      check(withdrawn.item.status === "withdrawn", "operation namespaces do not share responses");
    }
  },
  {
    id: "R2-PROP-03E",
    name: "changed withdraw reason never replays a prior success",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t03e-create");
      const write = context(h, "t03e-withdraw", draft.item.etag);
      await h.governance.withdrawProposal(draft.item.id, { reason: "first" }, write);
      await conflict(h.governance.withdrawProposal(draft.item.id, { reason: "second" }, write));
    }
  },
  {
    id: "R2-PROP-04",
    name: "new key with old ETag is rejected without state change",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t04-create");
      await h.governance.submitProposal(draft.item.id, {}, context(h, "t04-submit", draft.item.etag));
      const before = await h.governance.getProposal(draft.item.id);
      await conflict(h.governance.withdrawProposal(draft.item.id, {}, context(h, "t04-stale", draft.item.etag)));
      equal(await h.governance.getProposal(draft.item.id), before, "stale write leaves state unchanged");
    }
  },
  {
    id: "R2-PROP-05",
    name: "every successful transition advances version and terminal state rejects submit",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t05-create");
      const submitted = await h.governance.submitProposal(draft.item.id, {}, context(h, "t05-submit", draft.item.etag));
      const withdrawn = await h.governance.withdrawProposal(draft.item.id, {}, context(h, "t05-withdraw", submitted.item.etag));
      check(withdrawn.item.etag !== submitted.item.etag, "withdraw advances ETag again");
      check(withdrawn.item.version > submitted.item.version, "withdraw advances version again");
      await conflict(h.governance.submitProposal(draft.item.id, {}, context(h, "t05-terminal", withdrawn.item.etag)));
    }
  },
  {
    id: "R2-PROP-05B",
    name: "accept and reject preserve complete snapshots and each terminal forbids all transitions",
    async run(h: ProposalContractHarness) {
      check(Boolean(h.setActor), "actor-switch harness is required");
      for (const terminal of ["accepted", "rejected", "withdrawn"] as const) {
        await h.setActor!("author");
        const draft = await create(h, `t05b-${terminal}-create`);
        const submitted = await h.governance.submitProposal(draft.item.id, {}, context(h, `t05b-${terminal}-submit`, draft.item.etag));
        await h.setActor!(terminal === "withdrawn" ? "author" : "reviewer");
        const write = context(h, `t05b-${terminal}-finish`, submitted.item.etag);
        const result = terminal === "accepted"
          ? await h.governance.acceptProposal(draft.item.id, { repositoryReference: "refs/heads/proposal-contract" }, write)
          : terminal === "rejected" ? await h.governance.rejectProposal(draft.item.id, { reason: "review rejects" }, write)
          : await h.governance.withdrawProposal(draft.item.id, {}, write);
        check(result.item.status === terminal && result.item.etag !== submitted.item.etag && result.item.version > submitted.item.version, "terminal version advances");
        equal(result.item.base, draft.item.base, "review preserves base");
        equal(result.item.requestedChange, draft.item.requestedChange, "review preserves content");
        check(result.item.submittedByPersonId === h.authorId, "review retains author");
        check((result.item.publicationIntentRef !== null) === (terminal === "accepted"), "only accept produces intent");
        const evidence = await h.businessEvidence?.();
        equal(await (terminal === "accepted"
          ? h.governance.acceptProposal(draft.item.id, { repositoryReference: "refs/heads/proposal-contract" }, write)
          : terminal === "rejected" ? h.governance.rejectProposal(draft.item.id, { reason: "review rejects" }, write)
          : h.governance.withdrawProposal(draft.item.id, {}, write)), result, "terminal replay returns complete original result");
        if (h.businessEvidence) equal(await h.businessEvidence(), evidence, "terminal replay has no duplicate effects");
        await h.setActor!("author");
        await conflict(h.governance.submitProposal(draft.item.id, {}, context(h, `t05b-${terminal}-illegal-submit`, result.item.etag)));
        await conflict(h.governance.withdrawProposal(draft.item.id, {}, context(h, `t05b-${terminal}-illegal-withdraw`, result.item.etag)));
        await h.setActor!("reviewer");
        await conflict(h.governance.acceptProposal(draft.item.id, { repositoryReference: "refs/heads/illegal" }, context(h, `t05b-${terminal}-illegal-accept`, result.item.etag)));
        await conflict(h.governance.rejectProposal(draft.item.id, { reason: "illegal" }, context(h, `t05b-${terminal}-illegal-reject`, result.item.etag)));
      }
      await h.setActor!("author");
    }
  },
  {
    id: "R2-PROP-06",
    name: "concurrent fresh ETag writes commit once and concurrent duplicate requests replay once",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t06-create");
      const results = await Promise.allSettled([
        h.governance.submitProposal(draft.item.id, {}, context(h, "t06-submit", draft.item.etag)),
        h.governance.withdrawProposal(draft.item.id, {}, context(h, "t06-withdraw", draft.item.etag))
      ]);
      check(results.filter((r) => r.status === "fulfilled").length === 1, "concurrent fresh writes permit exactly one commit");
      const rejected = results.find((r) => r.status === "rejected");
      check(rejected?.status === "rejected" && rejected.reason.details?.reason === "revision-conflict", "loser receives revision-conflict");
      const duplicateDraft = await create(h, "t06-duplicate-create");
      const write = context(h, "t06-duplicate", duplicateDraft.item.etag);
      const duplicate = await Promise.all([
        h.governance.submitProposal(duplicateDraft.item.id, {}, write),
        h.governance.submitProposal(duplicateDraft.item.id, {}, write)
      ]);
      equal(duplicate[0], duplicate[1], "concurrent duplicates share first snapshot");
    }
  },
  {
    id: "R2-PROP-07",
    name: "authenticated guest cannot replay an earlier authorized write",
    async run(h: ProposalContractHarness) {
      check(Boolean(h.setActor), "actor-switch harness is required");
      const body = createBody(h);
      const write = { catalogReleaseId: h.releaseId, idempotencyKey: "t07-create" };
      await h.governance.createProposal(body, write);
      await h.setActor!("guest");
      try {
        await h.governance.createProposal(body, write);
      } catch (error) {
        check((error as { code?: string }).code === "FORBIDDEN", "authenticated guest must be forbidden");
        return;
      } finally {
        await h.setActor!("author");
      }
      throw new Error("guest replay bypassed current authorization");
    }
  },
  {
    id: "R2-PROP-07B",
    name: "two authorized principals sharing create key never receive each other's result",
    async run(h: ProposalContractHarness) {
      check(Boolean(h.setActor), "actor-switch harness is required");
      const body = createBody(h);
      const write = { catalogReleaseId: h.releaseId, idempotencyKey: "t07b-create" };
      await h.governance.createProposal(body, write);
      await h.setActor!("other-author");
      try { await conflict(h.governance.createProposal(body, write)); }
      finally { await h.setActor!("author"); }
    }
  },
  {
    id: "R2-PROP-07C",
    name: "nonauthor, self reviewer, inactive and cross-organization access are refused",
    async run(h: ProposalContractHarness) {
      check(Boolean(h.setActor), "actor-switch harness is required");
      const draft = await create(h, "t07c-create");
      try {
        await h.setActor!("other-author");
        await failureCode(h.governance.submitProposal(draft.item.id, {}, context(h, "t07c-nonauthor-submit", draft.item.etag)), "FORBIDDEN");
        await failureCode(h.governance.withdrawProposal(draft.item.id, {}, context(h, "t07c-nonauthor-withdraw", draft.item.etag)), "FORBIDDEN");
        await h.setActor!("author");
        const submitted = await h.governance.submitProposal(draft.item.id, {}, context(h, "t07c-submit", draft.item.etag));
        await h.setActor!("self-reviewer");
        await failureCode(h.governance.acceptProposal(draft.item.id, { repositoryReference: "refs/self" }, context(h, "t07c-self-accept", submitted.item.etag)), "FORBIDDEN");
        await failureCode(h.governance.rejectProposal(draft.item.id, { reason: "self" }, context(h, "t07c-self-reject", submitted.item.etag)), "FORBIDDEN");
        await h.setActor!("inactive");
        await failureCode(h.governance.getProposal(draft.item.id), "FORBIDDEN");
        await h.setActor!("other-org");
        await failureCode(h.governance.getProposal(draft.item.id), "NOT_FOUND");
      } finally { await h.setActor!("author"); }
    }
  },
  {
    id: "R2-PROP-10",
    name: "changed release header rejects before replay",
    async run(h: ProposalContractHarness) {
      const body = createBody(h);
      await h.governance.createProposal(body, { catalogReleaseId: h.releaseId, idempotencyKey: "t10-create" });
      try {
        await h.governance.createProposal(body, { catalogReleaseId: "crel_unavailable", idempotencyKey: "t10-create" });
      } catch (error) {
        check((error as { details?: { reason?: string } }).details?.reason === "release-drift", "release drift precedes replay");
        return;
      }
      throw new Error("release drift was not rejected");
    }
  },
  {
    id: "R2-PROP-08",
    name: "old success is an immutable snapshot after subsequent transition",
    async run(h: ProposalContractHarness) {
      const draft = await create(h, "t08-create");
      const write = context(h, "t08-submit", draft.item.etag);
      const submitted = await h.governance.submitProposal(draft.item.id, {}, write);
      const saved = structuredClone(submitted);
      await h.governance.withdrawProposal(draft.item.id, {}, context(h, "t08-withdraw", submitted.item.etag));
      submitted.item.requestedChange.kind = "caller-corruption";
      const replay = await h.governance.submitProposal(draft.item.id, {}, write);
      equal(replay, saved, "old success remains immutable after withdraw");
      check((await h.governance.getProposal(draft.item.id)).item.status === "withdrawn", "replay does not mutate current state");
    }
  },
  {
    id: "R2-PROP-11",
    name: "distinct creates retain separate identities and history",
    async run(h: ProposalContractHarness) {
      const first = await create(h, "t11-first");
      const second = await create(h, "t11-second");
      check(first.item.id !== second.item.id, "distinct create keys need distinct Proposal IDs");
      equal(await h.governance.getProposal(first.item.id), first, "first Proposal remains addressable");
    }
  }
] as const;
