import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp, stopServices } from '../src/app.ts';
import { sleep } from '../src/core/util.ts';

// Awaria procesu w trakcie sesji z otwartą pozycją → po starcie sesja wraca jako wstrzymana,
// z pozycją, działającym feedem (także symulowanym) i bez wyjątków przy zdarzeniach 'error'.
test('odzyskiwanie po restarcie: sesja wstrzymana, pozycja zachowana, wznowienie działa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldesk-restart-'));
  const dbFile = path.join(dir, 'test.db');

  const first = createApp({ dbFile });
  await first.coordinator.init();
  first.settings.update('trading', { entryScenarios: [], evaluationIntervalSeconds: 60 });
  const session = await first.coordinator.startSession({
    tokenAddress: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    mode: 'paper',
    dataSource: 'simulated',
    startingCapitalUsd: 5,
  });
  first.coordinator.manualBuy(1);
  for (let i = 0; i < 100 && first.repo.listOpenPositions(session.id).length === 0; i++) await sleep(50);
  assert.equal(first.repo.listOpenPositions(session.id).length, 1);
  // „awaria”: bez zamykania sesji
  stopServices(first);
  first.db.close();

  const second = createApp({ dbFile });
  const loggedErrors: string[] = [];
  second.bus.on('error', (e) => void loggedErrors.push(e.message));
  await second.coordinator.init();
  const restored = second.coordinator.activeSession();
  assert.equal(restored?.id, session.id);
  assert.equal(restored?.status, 'paused');
  assert.equal(second.engine.state, 'PAUSED');
  assert.equal(second.repo.listOpenPositions(session.id).length, 1);
  assert.ok(second.market.snapshot, 'feed symulatora powinien działać po restarcie');
  assert.ok(loggedErrors.some((m) => m.includes('Przywrócono sesję')));

  second.coordinator.resume();
  assert.equal(second.coordinator.activeSession()?.status, 'running');
  assert.equal(second.engine.state, 'HOLDING');
  const ended = await second.coordinator.stop({ liquidate: true });
  assert.equal(ended.status, 'stopped');
  assert.equal(second.repo.listOpenPositions(session.id).length, 0);

  stopServices(second);
  second.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
