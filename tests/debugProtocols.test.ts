import { describe, expect, it } from 'vitest';
import { DapClient } from '../src/debug/dap';
import { fillLaunchArgs } from '../src/debug/debuggers';
import { describeValue, fileUrlToPath, pathToFileUrl, urlRegexFor } from '../src/debug/node';

describe('DapClient', () => {
  function setup(reverse: (command: string, args: any) => Promise<unknown> = async () => ({})) {
    const sent: any[] = [];
    const events: [string, any][] = [];
    const client = new DapClient(async (json) => void sent.push(JSON.parse(json)), {
      event: (name, body) => events.push([name, body]),
      reverseRequest: reverse,
    });
    return { client, sent, events };
  }

  it('pairs responses with requests', async () => {
    const { client, sent } = setup();
    const a = client.request('stackTrace', { threadId: 1 });
    const b = client.request('scopes', { frameId: 7 });
    expect(sent.map((m) => m.command)).toEqual(['stackTrace', 'scopes']);
    client.receive(JSON.stringify({ type: 'response', request_seq: sent[1].seq, success: true, body: { scopes: [] } }));
    client.receive(JSON.stringify({ type: 'response', request_seq: sent[0].seq, success: true, body: { stackFrames: [1] } }));
    expect(await a).toEqual({ stackFrames: [1] });
    expect(await b).toEqual({ scopes: [] });
  });

  it('rejects failed requests with the adapter’s message', async () => {
    const { client, sent } = setup();
    const p = client.request('evaluate', { expression: 'x' });
    client.receive(JSON.stringify({ type: 'response', request_seq: sent[0].seq, success: false, message: "name 'x' is not defined" }));
    await expect(p).rejects.toThrow("name 'x' is not defined");
  });

  it('passes events on and answers requests from the adapter', async () => {
    const { client, sent, events } = setup(async (command, args) => ({ processId: 42, command, title: args.title }));
    client.receive(JSON.stringify({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } }));
    expect(events).toEqual([['stopped', { reason: 'breakpoint', threadId: 1 }]]);
    client.receive(JSON.stringify({ seq: 9, type: 'request', command: 'runInTerminal', arguments: { title: 'x' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent[0]).toMatchObject({ type: 'response', request_seq: 9, success: true, body: { processId: 42, title: 'x' } });
  });

  it('fails waiting requests when the adapter goes away', async () => {
    const { client } = setup();
    const p = client.request('continue', { threadId: 1 });
    client.close(new Error('No module named debugpy'));
    await expect(p).rejects.toThrow('No module named debugpy');
    await expect(client.request('next')).rejects.toThrow('No module named debugpy');
  });
});

describe('launch arguments', () => {
  it('fills in {file} and {cwd} everywhere', () => {
    const args = fillLaunchArgs({ program: '{file}', cwd: '{cwd}', args: ['--in', '{cwd}\\data.txt'], justMyCode: true }, { file: 'C:\\x\\a.py', cwd: 'C:\\x' });
    expect(args).toEqual({ program: 'C:\\x\\a.py', cwd: 'C:\\x', args: ['--in', 'C:\\x\\data.txt'], justMyCode: true });
  });
});

describe('Node paths and URLs', () => {
  const path = 'C:\\Users\\Eirik\\Kode 1\\blåbær.mjs';

  it('converts between paths and file URLs', () => {
    const url = pathToFileUrl(path);
    expect(url).toBe('file:///C:/Users/Eirik/Kode%201/bl%C3%A5b%C3%A6r.mjs');
    expect(fileUrlToPath(url)).toBe(path);
    expect(fileUrlToPath('node:internal/main/run_main_module')).toBeUndefined();
  });

  it('matches the URL however Node spells it', () => {
    const re = new RegExp(urlRegexFor(path));
    expect(re.test('file:///C:/Users/Eirik/Kode%201/bl%C3%A5b%C3%A6r.mjs')).toBe(true);
    expect(re.test('file:///c:/users/eirik/kode%201/bl%c3%a5b%c3%a6r.mjs')).toBe(true);
    expect(re.test('file:///C:/Users/Eirik/Kode 1/blåbær.mjs')).toBe(true);
    expect(re.test('file:///C:/Users/Eirik/Kode%201/annen.mjs')).toBe(false);
    expect(re.test('file:///C:/Users/Eirik/Kode%201/blåbær.mjs.bak')).toBe(false);
  });
});

describe('describeValue', () => {
  it('shows values like the console does', () => {
    expect(describeValue({ type: 'string', value: 'hei' })).toBe('"hei"');
    expect(describeValue({ type: 'number', value: 3, description: '3' })).toBe('3');
    expect(describeValue({ type: 'number', unserializableValue: 'NaN', description: 'NaN' })).toBe('NaN');
    expect(describeValue({ type: 'undefined' })).toBe('undefined');
    expect(describeValue({ type: 'object', subtype: 'null', value: null })).toBe('null');
    expect(describeValue({ type: 'function', description: 'function sum(a, b) {\n  return a + b;\n}' })).toBe('ƒ sum()');
    expect(describeValue({ type: 'function', description: 'class Person {}' })).toBe('class Person');
  });

  it('previews arrays and objects', () => {
    expect(
      describeValue({
        type: 'object',
        subtype: 'array',
        description: 'Array(3)',
        preview: { type: 'object', overflow: false, properties: [
          { name: '0', type: 'number', value: '1' },
          { name: '1', type: 'string', value: 'to' },
          { name: '2', type: 'object', value: 'Array(2)', subtype: 'array' },
        ] },
      }),
    ).toBe('[1, "to", Array(2)]');
    expect(
      describeValue({
        type: 'object',
        className: 'Object',
        description: 'Object',
        preview: { type: 'object', overflow: true, properties: [{ name: 'navn', type: 'string', value: 'Eirik' }] },
      }),
    ).toBe('{navn: "Eirik", …}');
  });
});
