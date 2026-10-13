# Find and maintain engineering knowledge

> Chinese: [Chinese](../zh-CN/user-guide/knowledge.md)

## Who can do this

- Active Organization members with `knowledge:view` can browse and search in **Knowledge base (`/knowledge`)**. This includes guests, hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`) under the default roles.
- Hardware/software users and committers have `knowledge:edit`: they can create entries and edit, publish, archive, or restore their own entries. This does not grant control over another person's entries.
- Organization Admins and Platform Admins also have `knowledge:manage`: they can govern other people's entries and use **Knowledge admin (`/knowledge-admin`)** for index health, Agent drafts, and archived entries. These operations remain scoped to the current Organization.

Drafts are visible only to their creator and knowledge managers. Published and archived entries are readable by members with view permission, but **only published entries participate in search and Xiaoze knowledge retrieval**. For account and role setup, see [Account and access](account-and-access.md).

## Find a published answer

1. Open **Knowledge base (`/knowledge`)**. Without an active search, use the status and tag filters to browse entries you can read. Tags describe projects or topics; there is no folder hierarchy.
2. Enter a question or keywords in the knowledge search field and select **Search**. Search supports Chinese and English full text and returns published entries, not your drafts or archived material.
3. Open a result to read its content, tags, source, and current revision. For a file entry, inspect its text-extraction status and download the original file when needed.
4. Read the retrieval-mode label rather than assuming semantic search is active. It reports either semantic plus full-text retrieval or full-text only. **Clear search** returns to the entry list and its filters.

In an API-backed deployment, **Ask the knowledge base (Xiaoze)** on **Knowledge base (`/knowledge`)** opens the Xiaoze conversation panel. Ask your question there; this button opens the panel rather than submitting the search-field text automatically. Xiaoze can retrieve published knowledge through its tools and provide citation links back to entries. Open those sources and check their applicability before relying on an answer. This entry point is not available in mock mode, and drafts do not become retrievable just because Xiaoze created them.

![Knowledge search and entry list](images/knowledge-library.png)

*The knowledge library contains three published demo entries about thermal foldback, parameter review, and device setup.*

![Published thermal foldback knowledge entry with source and revision](images/knowledge-entry-detail.png)

*The published sample entry shows its troubleshooting text, tags, human source, and revision; it does not certify a real device diagnosis.*

## Create an entry or upload a file

On **Knowledge base (`/knowledge`)**, choose the content form that fits your material:

- **New Markdown entry**: enter a title, comma-separated tags (including project tags if useful), and the knowledge content. Use the preview to check readability, then select **Create draft**.
- **Upload file entry**: enter a title and tags, choose a file, and select **Upload and create draft**. The upload creates a separate file-form entry; it is not an attachment added to a Markdown entry.

PDF, Word `.docx`, plain text, and Markdown files have text extraction for retrieval. The picker also accepts legacy `.doc`, but the extractor does not support its binary format: convert it to `.docx` and replace the file if extraction fails. Check the displayed extraction status and reason; an accepted upload is not proof that the body is searchable. File binaries are replaceable, not editable in the Markdown editor.

New entries start as drafts. Review the content, applicable conditions, and any source evidence before publishing. Creating a draft alone does not make it available to search or Xiaoze.

When a Xiaoze-created draft cites a degraded source log analysis, the platform automatically adds the same provenance notice used for distilled drafts at the top of its body. It identifies rule fallback or early convergence, explains the limitation, and asks you to review the evidence before relying on the conclusion. An identical notice already at the start is not duplicated; drafts citing non-degraded or legacy analyses, and drafts without a source log, remain unchanged. The notice is editable draft content, not a publication block or a quality guarantee.

![New Markdown knowledge entry dialog](images/knowledge-new-entry.png)

*The new-entry dialog alongside the published examples; this screenshot does not create another draft.*

## Publish and revise an entry

1. On **Knowledge base (`/knowledge`)**, open a draft you own, or one you can govern as a manager, and select **Publish**. Publication is the trust gate into retrieval and queues an index refresh; indexing need not finish immediately.
2. To update a Markdown entry, select **Edit**, make the changes, and select **Save as new revision**. For a file entry, select **Replace file**, supply the replacement, and select **Replace and create new revision**. Old file versions remain in revision history.
3. Every content save appends an immutable revision. **A published entry is revised in place and stays published**; there is no pending-changes approval state. Check the change before saving, because it updates the published content and queues an index refresh.
4. Open **Revision history** to inspect earlier versions. For a non-archived entry, an owner with edit permission or a manager can choose **Restore this version**, then confirm **Restore as new revision**. This appends another revision without rewriting history or changing publication status.

If a save reports that another revision has already become current, preserve your edits, refresh the entry, reconcile the changes, and retry against the current revision. Do not assume a conflicting save was applied.

## Archive outdated knowledge or restore it

On **Knowledge base (`/knowledge`)**, open a published entry you can govern and select **Archive**. Archiving removes it from retrieval without deleting the entry or its history. Use the archived status filter to find it later. Select **Restore as published** to make it published again; restore it before editing its content.

On **Knowledge admin (`/knowledge-admin`)**, managers can also restore entries from the archived list. **Permanently delete** is different from archive: its confirmation requires an acknowledgement and deletes the entry and all revisions irreversibly. Do not use it merely to retire outdated guidance.

Managers can review the Agent-draft queue on **Knowledge admin (`/knowledge-admin`)**, inspect the creator and available session or source links, then publish the reviewed content or reject and archive it. This draft-to-archive rejection is specific to Agent drafts; ordinary drafts must be published before the normal archive action is available.

## Check index health and request a rebuild

Knowledge managers use **Knowledge admin (`/knowledge-admin`)**, in the **Retrieval index health** section:

1. Check the retrieval-mode banner. Full-text-only mode means semantic retrieval is degraded or unavailable, not that full-text search is disabled. The banner also reports vector support and whether an embedding endpoint is configured; deployment repairs belong to the operator.
2. Inspect each entry's lifecycle status, indexed revision number, index status, chunk counts, and failure reason. The index states are **Pending**, **Processing**, **Indexed**, and **Failed**. Compare the indexed revision with the entry's current revision before assuming the latest content has been processed.
3. For an affected entry, read the failure reason, address the underlying issue (for example, replace a file whose extraction failed), and select **Retry**. Repeating a retry does not fix an unsupported file format or an unavailable service.
4. Select **Rebuild all indexes** when the published set needs rebuilding. The notice reports how many published entries were re-enqueued. This queues background work; it does not certify that rebuilding has completed. Use **Refresh** to check outcomes and remaining failures.

An index failure can concern text extraction or embeddings; it does not by itself prove that every full-text query is unavailable. Diagnose using the displayed reason and actual retrieval mode, not the status badge alone.

## Find the maintained references

- [Account and access](account-and-access.md): registration and role administration.
- [Knowledge retrieval architecture decision](../adr/0025-knowledge-retrieval-lives-in-postgres.md): the maintained retrieval architecture, for developers and operators.
- [User-operation coverage matrix](../developer/user-operation-coverage-matrix.md): the repository's knowledge operation and acceptance-test map, not a claim of verification for your deployment.
