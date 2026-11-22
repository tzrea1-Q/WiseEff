/** These read plans are cheaper to interpret than to compile at request scale. */
export async function disableBindingReadJit(client: { query(text: string): Promise<unknown> }): Promise<void> {
  await client.query("set local jit = off");
}
