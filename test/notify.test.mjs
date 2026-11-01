import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildMessage, loadConfig, NotificationError, sendWebhook, validateWebhook } from '../notify.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(ROOT, 'notify.mjs');
const PROGRAM = {
  NAME: 'サンプル番組',
  CHANNELNAME: 'NHK総合',
  STARTAT: String(Date.parse('2026-10-26T21:00:00+09:00')),
  ENDAT: String(Date.parse('2026-10-26T21:30:00+09:00')),
  DESCRIPTION: '番組概要のサンプルです。',
};
// テスト専用のダミー。実際の Slack に送信しない。
const WEBHOOK = 'https://hooks.slack.com/services/TEST/TEST/not-a-real-webhook';
const TIME = '21:00～21:30［NHK総合］';

function tempDirectory(t) {
  const folder = mkdtempSync(join(tmpdir(), 'epgs-to-slack-test-'));
  t.after(() => {
    assert.equal(dirname(folder), tmpdir());
    assert.ok(folder.startsWith(join(tmpdir(), 'epgs-to-slack-test-')));
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function cli(args, env = {}, cwd = ROOT) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...PROGRAM, SLACK_WEBHOOK_URL: '', EPGS_TIMEZONE: 'Asia/Tokyo', ...env },
  });
}

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    instance.closeAllConnections();
    await new Promise((resolve) => instance.close(resolve));
  });
  return `http://127.0.0.1:${instance.address().port}/webhook`;
}

test('予約メッセージは指定の絵文字・日付・時刻・放送局・概要を使う', () => {
  assert.equal(buildMessage('reserve', PROGRAM),
    ':new: *サンプル番組*\n```2026/10/26月曜日 ' + TIME + '\n番組概要のサンプルです。```');
});

test('開始メッセージは指定の書式を使う', () => {
  assert.equal(buildMessage('start', PROGRAM), ':black_circle_for_record: *サンプル番組*\n```' + TIME + '```');
});

test('終了メッセージは指定の書式を使う', () => {
  assert.equal(buildMessage('end', PROGRAM), ':black_square_for_stop: *サンプル番組*\n```' + TIME + '```');
});

test('秒が含まれる時刻も分まで表示する', () => {
  const program = {
    ...PROGRAM,
    STARTAT: String(Date.parse('2026-10-26T18:30:45+09:00')),
    ENDAT: String(Date.parse('2026-10-26T20:50:59+09:00')),
    CHANNELNAME: 'テレ東',
  };
  for (const event of ['reserve', 'start', 'end']) {
    assert.ok(buildMessage(event, program).includes('18:30～20:50［テレ東］'));
  }
});

test('日付をまたぐ録画と午前0時を表示できる', () => {
  const message = buildMessage('start', {
    ...PROGRAM,
    STARTAT: String(Date.parse('2026-10-26T23:30:00+09:00')),
    ENDAT: String(Date.parse('2026-10-27T00:00:00+09:00')),
  });
  assert.ok(message.includes('23:30～00:00'));
});

test('タイムゾーンを明示的に指定できる', () => {
  assert.ok(buildMessage('start', PROGRAM, 'UTC').includes('12:00～12:30'));
});

test('番組名・放送局・概要が欠けても undefined や null を表示しない', () => {
  const message = buildMessage('reserve', { ...PROGRAM, NAME: '', CHANNELNAME: null, DESCRIPTION: undefined });
  assert.ok(message.includes('*番組名なし*'));
  assert.ok(message.includes('［放送局名なし］'));
  assert.doesNotMatch(message, /undefined|null/);
});

test('不明なイベントや Object のプロパティ名をイベントとして受け付けない', () => {
  for (const event of ['update', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => buildMessage(event, PROGRAM), NotificationError);
  }
});

test('空・小数・不正な日時を送信前に検出する', () => {
  for (const key of ['STARTAT', 'ENDAT']) {
    for (const value of [undefined, '', ' ', 'not-a-date', '-1', '1.5', 'Infinity', '9000000000000000']) {
      assert.throws(() => buildMessage('start', { ...PROGRAM, [key]: value }), NotificationError);
    }
  }
});

test('終了が開始より前ならエラーになる', () => {
  assert.throws(() => buildMessage('start', { ...PROGRAM, ENDAT: '0' }), /ENDAT は STARTAT/);
});

test('不正なタイムゾーンを検出する', () => {
  assert.throws(() => buildMessage('start', PROGRAM, 'Invalid/Zone'), /EPGS_TIMEZONE/);
});

test('番組情報からの Slack メンションと書式の崩れを抑える', () => {
  const message = buildMessage('reserve', {
    ...PROGRAM,
    NAME: '<!channel> *番組*\n`特別編` & 続編',
    CHANNELNAME: '<@USER>',
    DESCRIPTION: '説明```\n<!here> & 続き\n絵文字😀',
  });
  assert.doesNotMatch(message, /<!channel>|<!here>|<@USER>/);
  assert.ok(message.includes('&lt;!channel&gt; ＊番組＊ ｀特別編｀ &amp; 続編'));
  assert.equal(message.split('```').length, 3);
  assert.ok(message.includes('絵文字😀'));
});

test('長い番組情報を省略してメッセージとコードブロックを保つ', () => {
  const message = buildMessage('reserve', {
    ...PROGRAM, NAME: '😀'.repeat(1000), CHANNELNAME: '放送局'.repeat(1000), DESCRIPTION: '概要'.repeat(10000),
  });
  assert.ok(Array.from(message).length < 4000);
  assert.ok(message.endsWith('…```'));
  assert.doesNotMatch(message, /\uFFFD/);
});

test('.env なしでも環境変数を使え、既定は日本時間になる', (t) => {
  const folder = tempDirectory(t);
  assert.deepEqual(loadConfig({ SLACK_WEBHOOK_URL: WEBHOOK }, join(folder, 'missing.env')), {
    webhookUrl: WEBHOOK, timeZone: 'Asia/Tokyo',
  });
});

test('引用符付き .env を読み込み、環境変数が優先される', (t) => {
  const file = join(tempDirectory(t), 'config.env');
  writeFileSync(file, `SLACK_WEBHOOK_URL='${WEBHOOK}'\nEPGS_TIMEZONE=UTC\nNAME=上書きしない\n`);
  assert.deepEqual(loadConfig({}, file), { webhookUrl: WEBHOOK, timeZone: 'UTC' });
  const env = { SLACK_WEBHOOK_URL: ` ${WEBHOOK} `, EPGS_TIMEZONE: 'Asia/Tokyo', NAME: 'サンプル番組' };
  const original = { ...env };
  assert.deepEqual(loadConfig(env, file), {
    webhookUrl: WEBHOOK, timeZone: 'Asia/Tokyo',
  });
  assert.deepEqual(env, original);
});

test('.env を読み込めない場合は秘密を含まないエラーを返す', (t) => {
  assert.throws(() => loadConfig({}, tempDirectory(t)), /\.env を読み込めません/);
});

test('正しい Slack Incoming Webhook URL を受け付ける', () => {
  assert.equal(validateWebhook(WEBHOOK), WEBHOOK);
});

test('Slack 以外・平文 HTTP・認証情報・クエリ等を受け付けない', () => {
  const invalid = [
    '', 'not-a-url', 'http://hooks.slack.com/services/T/B/S',
    'https://example.com/services/T/B/S', 'https://hooks.slack.com.evil.test/services/T/B/S',
    'https://user:password@hooks.slack.com/services/T/B/S',
    'https://hooks.slack.com:8443/services/T/B/S', `${WEBHOOK}?secret=example`, `${WEBHOOK}#secret`,
    'https://hooks.slack.com/services/T/B',
  ];
  for (const value of invalid) assert.throws(() => validateWebhook(value), NotificationError);
});

test('実際の HTTP 通信で JSON の text と Content-Type を送る', async (t) => {
  let received;
  const url = await server(t, async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { method: request.method, headers: request.headers, body: JSON.parse(body) };
    response.end('ok');
  });
  const text = buildMessage('reserve', { ...PROGRAM, DESCRIPTION: '引用符 " と改行\n次の行' });
  await sendWebhook(url, text);
  assert.equal(received.method, 'POST');
  assert.equal(received.headers['content-type'], 'application/json');
  assert.deepEqual(received.body, { text });
});

test('HTTP エラーで応答本文や Webhook URL をエラーに含めない', async (t) => {
  const url = await server(t, (_request, response) => {
    response.writeHead(403);
    response.end(`invalid_token ${WEBHOOK}`);
  });
  await assert.rejects(sendWebhook(url, 'test'), (error) => {
    assert.ok(error instanceof NotificationError);
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes(WEBHOOK));
    assert.ok(!error.message.includes('invalid_token'));
    return true;
  });
});

test('HTTP 200 でも ok 以外の応答は失敗扱いになる', async () => {
  await assert.rejects(sendWebhook(WEBHOOK, 'test', {
    fetchImpl: async () => new Response('invalid_payload', { status: 200 }),
  }), /送信に失敗/);
});

test('HTTP 429 は明確なエラーになり、自動再送しない', async () => {
  let calls = 0;
  await assert.rejects(sendWebhook(WEBHOOK, 'test', {
    fetchImpl: async () => {
      calls += 1;
      return new Response('rate_limited', { status: 429 });
    },
  }), /送信数の制限/);
  assert.equal(calls, 1);
});

test('接続エラーに含まれる URL をログへ流さない', async () => {
  await assert.rejects(sendWebhook(WEBHOOK, 'test', {
    fetchImpl: async () => { throw new Error(`network failure ${WEBHOOK}`); },
  }), (error) => {
    assert.match(error.message, /Slack へ接続できません/);
    assert.ok(!error.message.includes(WEBHOOK));
    return true;
  });
});

test('リダイレクト先へ通知データを送らない', async (t) => {
  let calls = 0;
  const url = await server(t, (_request, response) => {
    calls += 1;
    response.writeHead(307, { Location: '/other' });
    response.end();
  });
  await assert.rejects(sendWebhook(url, 'test'), /Slack へ接続できません/);
  assert.equal(calls, 1);
});

test('応答が来ない接続をタイムアウトで終了する', async (t) => {
  const url = await server(t, () => {});
  await assert.rejects(sendWebhook(url, 'test', { timeoutMs: 100 }), /タイムアウト/);
});

test('ヘッダー受信後に本文が来ない場合もタイムアウトする', async (t) => {
  const url = await server(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.flushHeaders();
    response.write('o');
  });
  await assert.rejects(sendWebhook(url, 'test', { timeoutMs: 100 }), /タイムアウト/);
});

test('CLI の3イベントを Webhook なしの dry-run で実行できる', () => {
  for (const event of ['reserve', 'start', 'end']) {
    const result = cli([event, '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { text: buildMessage(event, PROGRAM) });
    assert.equal(result.stderr, '');
  }
});

test('別の作業フォルダーからでも CLI を実行できる', (t) => {
  const result = cli(['reserve', '--dry-run'], {}, tempDirectory(t));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).text, buildMessage('reserve', PROGRAM));
});

test('ホスト TZ が UTC でも既定の表示は日本時間になる', () => {
  const result = cli(['start', '--dry-run'], { TZ: 'UTC' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).text.includes(TIME));
});

test('ヘルプは番組情報も Webhook も不要', () => {
  const result = cli(['--help'], { STARTAT: '', ENDAT: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /使い方/);
});

test('CLI の誤った引数は終了コード1で失敗する', () => {
  for (const args of [[], ['unknown', '--dry-run'], ['reserve', 'start'], ['start', '--unknown']]) {
    const result = cli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[epgs-to-slack\]/);
    assert.equal(result.stdout, '');
  }
});

test('Webhook 未設定・不正な日時は送信せず終了コード1になる', () => {
  for (const env of [{ SLACK_WEBHOOK_URL: '' }, { SLACK_WEBHOOK_URL: WEBHOOK, STARTAT: '' }]) {
    const result = cli(['reserve'], env);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /not-a-real-webhook|at main|at file/);
  }
});

test('プレビュー用の番組データと実装が一致する', () => {
  const result = spawnSync(process.execPath, ['--env-file=examples/program.env', SCRIPT, 'reserve', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        ![...Object.keys(PROGRAM), 'SLACK_WEBHOOK_URL'].includes(key))),
      EPGS_TIMEZONE: 'Asia/Tokyo',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { text: buildMessage('reserve', PROGRAM) });
});

test('EPGStation 設定例は公式の3種類のフックとイベントを対応させる', () => {
  const config = readFileSync(join(ROOT, 'examples/epgstation.config.yml'), 'utf8');
  assert.match(config, /^reserveNewAddtionCommand: 'node \/opt\/epgs-to-slack\/notify\.mjs reserve'$/m);
  assert.match(config, /^recordingStartCommand: 'node \/opt\/epgs-to-slack\/notify\.mjs start'$/m);
  assert.match(config, /^recordingFinishCommand: 'node \/opt\/epgs-to-slack\/notify\.mjs end'$/m);
});
