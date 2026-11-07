// 첨부 파일 내용 검색's reader, off the server's thread: one file at a time, its text or why there is none.
import { parentPort } from 'node:worker_threads';
import { readFileSync, statSync } from 'node:fs';
import { extractFileText, sizeLimit, textKind } from './file-text.mjs';

parentPort.on('message', job => {
  let result;
  try {
    // The size is checked before the file is read.
    result = statSync(job.file).size > sizeLimit(textKind(job.name, job.mediaType)) ? { status: 'unsupported', error: 'size' } : extractFileText(readFileSync(job.file), job);
  }
  catch (error) { result = error?.code === 'ENOENT' ? { status: 'missing', error: 'missing' } : { status: 'failed', error: String(error?.message ?? error).slice(0, 200) }; }
  parentPort.postMessage({ sha256: job.sha256, ...result });
});
