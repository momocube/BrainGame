import path from 'node:path';

const SOURCE_MANUAL_FILENAME = '704現場操作手冊_v1.md';
const PACKAGED_MANUAL_FILENAME = '704-operation-manual.md';

export function resolveOperationManualPath({ isPackaged = false, resourcesPath = '', appRoot = '' } = {}) {
  if (isPackaged) return path.join(resourcesPath, PACKAGED_MANUAL_FILENAME);
  return path.join(appRoot, 'docs', SOURCE_MANUAL_FILENAME);
}
