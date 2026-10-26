import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const EMOJI = {
  reserve: ':new:',
  start: ':black_circle_for_record:',
  end: ':black_square_for_stop:',
};

const HELP = `使い方: node notify.mjs <reserve|start|end> [--dry-run]

  reserve    録画予約（日時・放送局・番組概要）
  start      録画開始（時刻・放送局）
  end        録画終了（時刻・放送局）
  --dry-run  Slack へ送信せず JSON を表示
  --help     このヘルプを表示

EPGStation の環境変数 NAME / CHANNELNAME / STARTAT / ENDAT / DESCRIPTION を使用します。
設定は notify.mjs と同じフォルダーの .env、または環境変数で指定します。`;

export class NotificationError extends Error {}

export function loadConfig(env = process.env, envFile = new URL('./.env', import.meta.url)) {
  let file = {};
  try {
    file = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new NotificationError('.env を読み込めません。形式と読み取り権限を確認してください。');
    }
  }

  // .env は通知設定だけに使い、EPGStation から渡された番組情報を上書きしない。
  return {
    webhookUrl: (env.SLACK_WEBHOOK_URL ?? file.SLACK_WEBHOOK_URL ?? '').trim(),
    timeZone: (env.EPGS_TIMEZONE ?? file.EPGS_TIMEZONE ?? 'Asia/Tokyo').trim(),
  };
}

export function validateWebhook(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new NotificationError('SLACK_WEBHOOK_URL に Slack Incoming Webhook URL を設定してください。');
  }

  if (
    url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || url.port ||
    url.username || url.password || url.search || url.hash ||
    !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)
  ) {
    throw new NotificationError('SLACK_WEBHOOK_URL は https://hooks.slack.com/services/ から始まる Webhook URL を指定してください。');
  }
  return url.href;
}

function timestamp(value, name) {
  const number = Number(value);
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(number) || Number.isNaN(new Date(number).getTime())) {
    throw new NotificationError(`${name} に EPGStation の UNIX 時刻（ミリ秒）が必要です。`);
  }
  return new Date(number);
}

function slackText(value, maxLength, singleLine = false) {
  let text = String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  text = text.replaceAll('```', '｀｀｀');
  if (singleLine) text = text.replace(/[\r\n]+/g, ' ').replaceAll('*', '＊').replaceAll('`', '｀');
  const characters = Array.from(text);
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : text;
}

export function buildMessage(event, env, timeZone = 'Asia/Tokyo') {
  if (!Object.hasOwn(EMOJI, event)) {
    throw new NotificationError('イベントは reserve / start / end のいずれかを指定してください。');
  }
  const start = timestamp(env.STARTAT, 'STARTAT');
  const end = timestamp(env.ENDAT, 'ENDAT');
  if (end < start) throw new NotificationError('ENDAT は STARTAT 以降の時刻を指定してください。');

  let dateFormatter;
  let timeFormatter;
  try {
    dateFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    });
    timeFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    throw new NotificationError('EPGS_TIMEZONE に有効なタイムゾーン（例: Asia/Tokyo）を指定してください。');
  }

  const title = slackText(env.NAME || '番組名なし', 300, true);
  const channel = slackText(env.CHANNELNAME || '放送局名なし', 100, true);
  const time = `${timeFormatter.format(start)}～${timeFormatter.format(end)}［${channel}］`;
  const detail = event === 'reserve'
    ? `${dateFormatter.format(start)} ${time}\n${slackText(env.DESCRIPTION || '', 3000)}`
    : time;

  return `${EMOJI[event]} *${title}*\n\`\`\`${detail}\`\`\``;
}

export async function sendWebhook(url, text, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  let response;
  let body;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await response.text();
  } catch (error) {
    // fetch のエラーや Slack の応答本文に秘密情報が含まれる可能性があるため、そのまま出力しない。
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new NotificationError('Slack への送信がタイムアウトしました。');
    }
    throw new NotificationError('Slack へ接続できません。ネットワーク・DNS・証明書を確認してください。');
  }

  if (!response.ok || body.trim() !== 'ok') {
    const hint = response.status === 429
      ? '送信数の制限に達しました。'
      : 'Webhook URL と投稿先チャンネルを確認してください。';
    throw new NotificationError(`Slack への送信に失敗しました（HTTP ${response.status}）。${hint}`);
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    });
  } catch {
    throw new NotificationError('引数が正しくありません。node notify.mjs --help で使い方を確認してください。');
  }
  if (parsed.values.help) {
    console.log(HELP);
    return;
  }
  if (parsed.positionals.length !== 1) {
    throw new NotificationError('reserve / start / end のいずれか1つを指定してください。');
  }

  const event = parsed.positionals[0];
  const config = loadConfig(env);
  const text = buildMessage(event, env, config.timeZone);
  if (parsed.values['dry-run']) {
    console.log(JSON.stringify({ text }, null, 2));
    return;
  }
  await sendWebhook(validateWebhook(config.webhookUrl), text);
  console.log(`[epgs-to-slack] ${event} の通知を送信しました。`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof NotificationError ? error.message : '予期しないエラーが発生しました。';
    console.error(`[epgs-to-slack] ${message}`);
    process.exitCode = 1;
  });
}
