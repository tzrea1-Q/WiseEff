export const DEFINITION_BATCH_LIMIT = 128;
export const MOCK_DEFINITION_BATCH_UNSUPPORTED = "模拟模式不支持，请使用 API 模式。";

export class MockDefinitionBatchUnsupportedError extends Error {
  constructor() { super(MOCK_DEFINITION_BATCH_UNSUPPORTED); }
}
