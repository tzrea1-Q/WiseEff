# Database roots and checkout observation

Chinese: [中文](README.zh-CN.md).

`createPostgresDatabase` owns a PostgreSQL pool and returns a branded
`RootDatabase`. Its transactions own BEGIN/COMMIT; nested transactions use
savepoints. `createDatabase` and `createSavepointDatabase` wrap a single session,
not a pool. The Catalog Kernel continues to obtain the real root pool through
`getRootPostgresPool` and to own its read-only transactions.

The optional `verifyCheckout(session)` construction option observes **each actual
borrowed connection** before it is exposed to root queries, transactions, raw
promise/callback checkout or the raw pool's query method. The supplied session
has only `query`; the observer must finish its probes and release probe locks
without opening a caller transaction. It must not recursively borrow from the
same pool. A rejected observation destroys that connection and preserves its
error. Nothing executes while verification is pending. Success transfers the
lease to the normal caller, which retains its normal release responsibility.
The owner must bound its observation; this hook is not a timeout extension.
During asynchronous verification the pool owns a temporary connection error
listener. A disconnect refuses the lease with a static diagnostic, destroys it
once, and prevents a pending observer from issuing more probe SQL. An admission
error that wins the race is retained; non-Error rejections receive a static error
so pg's callback API cannot interpret a falsy value as success. The destroyed
client retains its listener until `end`; a successful lease relinquishes it.

The hook grants no database permission and makes no release decision. Only a
server-owned composition root may configure it. The activation owner uses it to
bind the Kernel's actual session to independently observed physical target
identity; probing another connection before/after the Kernel call is insufficient.
The observer remains responsible for real evidence and drift checks. No external
transaction or private Kernel interface is added. Pools without the option keep
the existing behavior; startup report approval remains a separate operation.

`verifiedCheckout.test.ts` covers dispatch and lifecycle with a controlled pool.
Those units are not PostgreSQL or deployment identity evidence. Actual target
observations and limited-login Kernel acceptance belong to the activation and
reader lanes, recorded in the populated-upgrade evidence document.
