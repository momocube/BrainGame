import fs from 'node:fs';
import path from 'node:path';

export function createOperationalLog({ dataDir, now = () => new Date() }) {
  const directory = path.resolve(dataDir, 'logs');
  fs.mkdirSync(directory, { recursive: true });

  return {
    write(event) {
      try {
        const timestamp = now().toISOString();
        const details = event.details ?? {};
        let safeDetails;
        try {
          safeDetails = JSON.parse(JSON.stringify(details));
        } catch {
          safeDetails = { serializationError: true };
        }
        if (Buffer.byteLength(JSON.stringify(safeDetails), 'utf8') > 4096) safeDetails = { truncated: true };
        const record = {
          timestamp,
          level: event.level ?? 'info',
          type: String(event.type ?? 'application').slice(0, 80),
          action: String(event.action ?? 'event').slice(0, 100),
          sessionId: typeof event.sessionId === 'string' ? event.sessionId : null,
          details: safeDetails
        };
        const day = timestamp.slice(0, 10);
        fs.appendFileSync(path.join(directory, `operations-${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
      } catch (error) {
        console.error('營運日誌寫入失敗：', error.message);
      }
    }
  };
}
