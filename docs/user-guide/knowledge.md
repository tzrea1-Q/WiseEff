# Find and maintain engineering knowledge

> Chinese: [Chinese](../zh-CN/user-guide/knowledge.md)

## Who can do this

- Active Organization members with `knowledge:view` can browse and search in Knowledge base (`/knowledge`). This includes guests, hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`) under the default roles.
- Hardware/software users and committers have `knowledge:edit`: they can create entries and edit, publish, archive, or restore their own entries. Managing someone else's entries requires additional permission.
- Organization Admins and Platform Admins also have `knowledge:manage`: they can maintain other people's entries and use Knowledge admin (`/knowledge-admin`) to check index health and manage Agent drafts and archived entries. These operations are limited to the current Organization.

Drafts are visible only to their creator and knowledge managers. Members with view permission can read published and archived entries; search and Xiaoze knowledge retrieval use only published entries. For account and role setup, see [Account and access](account-and-access.md).

## Find a published answer

1. Open Knowledge base (`/knowledge`). Without an active search, use the status and tag filters to browse entries you can read. Use tags to identify projects or topics; the knowledge base has no folder hierarchy.
2. Enter a question or keywords in the knowledge search field and select Search. Full-text search supports Chinese and English. Results include only published entries; drafts and archived material are excluded.
3. Open a result to read its content, tags, source, and current revision. For a file entry, inspect its text-extraction status and download the original file when needed.
4. Check the retrieval-mode label to see whether semantic search is available. It reports either semantic plus full-text retrieval or full-text only. Select Clear search to return to the entry list and its filters.

In an API-backed deployment, select Ask the knowledge base (Xiaoze) on Knowledge base (`/knowledge`) to open the Xiaoze conversation panel. Ask your question there; text in the search field is not sent automatically. Xiaoze can retrieve published knowledge through its tools and provide citation links to the original entries. Open those sources and check their applicability before relying on an answer. This entry point is unavailable in mock mode, and Xiaoze-created drafts must be published before they can be retrieved.

![Knowledge search and entry list](images/knowledge-library.png)

*The knowledge library contains three published demo entries about thermal foldback, parameter review, and device setup.*

![Published thermal foldback knowledge entry with source and revision](images/knowledge-entry-detail.png)

*The published sample entry shows its troubleshooting text, tags, human source, and revision; it does not certify a real device diagnosis.*

## Create an entry or upload a file

On Knowledge base (`/knowledge`), choose the content form that fits your material:

- Select New Markdown entry and enter a title, comma-separated tags, and the content. Project tags can help identify where the guidance applies. Check the preview, then select Create draft.
- Select Upload file entry, enter a title and tags, choose a file, and select Upload and create draft. The upload creates a separate file entry rather than attaching the file to a Markdown entry.

Text can be extracted from PDF, Word `.docx`, plain text, and Markdown files for retrieval. The picker also accepts legacy `.doc`, but the extractor does not support its binary format. If extraction fails, convert the file to `.docx` and replace it. After uploading, check the displayed extraction status and reason to see whether the body is searchable. You can replace an original file, but cannot edit it in the Markdown editor.

New entries start as drafts. Review the content, applicable conditions, and source evidence before publishing. Only after publication can the entry appear in search or Xiaoze knowledge retrieval.

When a Xiaoze-created draft cites a degraded source log analysis, the platform automatically adds a source notice at the top of the body, using the same notice as distilled drafts. It identifies rule fallback or early convergence, explains the limitation, and asks you to review the evidence before relying on the conclusion. An identical notice already at the start is not added again. Drafts citing non-degraded or legacy analyses, and drafts without a source log, remain unchanged. You can edit the notice as part of the draft. It does not block publication or guarantee content quality.

![New Markdown knowledge entry dialog](images/knowledge-new-entry.png)

*The new-entry dialog alongside the published examples; this screenshot does not create another draft.*

## Publish and revise an entry

1. On Knowledge base (`/knowledge`), open a draft you own, or one you can maintain as a manager, and select Publish. Publication makes the entry eligible for retrieval and queues an index refresh, which may take time to complete.
2. To update a Markdown entry, select Edit, make the changes, and select Save as new revision. For a file entry, select Replace file, supply the replacement, and select Replace and create new revision. Old file versions remain in revision history.
3. Every content save appends an immutable revision. A published entry stays published after saving; there is no pending-changes approval state. Check the content first: saving directly updates the published body and queues an index refresh.
4. Open Revision history to inspect earlier versions. For a non-archived entry, an owner with edit permission or a manager can choose Restore this version, then confirm Restore as new revision. This appends another revision while preserving the existing history and publication status.

If a save reports that someone else has updated the current revision, your save encountered a conflict and has not succeeded. Preserve your edits, refresh the entry, compare the changes, and retry against the current revision.

## Archive outdated knowledge or restore it

On Knowledge base (`/knowledge`), open a published entry you can maintain and select Archive. Archiving removes it from retrieval and preserves its content and history. Use the archived status filter to find it later, then select Restore as published to publish it again. Restore an archived entry before editing its content.

On Knowledge admin (`/knowledge-admin`), managers can also restore entries from the archived list. Permanently delete requires an acknowledgement during confirmation and removes the entry and all revisions irreversibly. If you only need to retire outdated guidance, archive it.

Managers with `knowledge:manage` can also permanently delete a human-authored draft directly from its detail or the row's More menu on Knowledge base (`/knowledge`), without publishing or archiving it first. Confirm the scope and acknowledge the irreversible action. Deletion removes the entry, all revisions, file metadata, parameter references and linked retrieval/index records; audit records remain. Original file objects in storage are retained by the existing deletion contract. Other entries, shared parameter definitions and source logs are not deleted. Cancelling leaves the draft unchanged; a failed request keeps the confirmation and its error available for retry. If another administrator has already deleted it, the request reports that the entry no longer exists; close the dialog and refresh the list.

In the Agent-draft queue on Knowledge admin (`/knowledge-admin`), managers can check the creator and available session or source links, then publish the reviewed content or reject and archive it. Rejecting a draft directly into archive is available only for Agent drafts. Ordinary drafts must be published before the normal archive action is available.

## Check index health and request a rebuild

Knowledge managers open Knowledge admin (`/knowledge-admin`) and go to Retrieval index health:

1. Check the retrieval-mode banner. Full-text-only mode means semantic retrieval is degraded or unavailable; it does not mean full-text search is disabled. The banner also reports vector support and whether an embedding endpoint is configured. Ask the operator to resolve deployment problems.
2. Inspect each entry's publication status, indexed revision number, index status, chunk counts, and failure reason. The index states are Pending, Processing, Indexed, and Failed. Compare the indexed revision with the current revision to check whether the latest content has been processed.
3. For an affected entry, read the failure reason and address the underlying issue, such as replacing a file whose extraction failed, then select Retry. Unsupported file formats or unavailable services must be resolved first; repeated retries will not help.
4. Select Rebuild all indexes when indexes for the published entries need rebuilding. The notice reports how many published entries were added back to the background queue. This confirms that work was queued, not that rebuilding has finished. Use Refresh to check outcomes and remaining failures.

An index failure may come from text extraction or embedding generation. To assess whether full-text search is available, check the failure reason and actual retrieval mode alongside the status badge.

## Find the maintained references

- [Account and access](account-and-access.md): registration and role administration.
- [Knowledge retrieval architecture decision](../adr/0025-knowledge-retrieval-lives-in-postgres.md): retrieval architecture for developers and operators.
- [User-operation coverage matrix](../developer/user-operation-coverage-matrix.md): an index of knowledge operations and acceptance tests in the repository. Your deployment needs its own verification.
