import { collectDtsEditorFolds } from "./dtsEditorFolds";

self.onmessage = (event: MessageEvent<{ sessionKey: string; generation: number; analysisId: number; text: string }>) => {
  const { sessionKey, generation, analysisId, text } = event.data;
  self.postMessage({ sessionKey, generation, analysisId, folds: collectDtsEditorFolds(text) });
};
