import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapCommand, adaptLesson, labKeySource } from '../../client/src/features/learning/guides/inf1003/local-setup.js';
import { GUIDE_LOCAL_META } from '../../client/src/features/learning/guides/inf1003/local-meta.generated.js';
import { GUIDE_SCRIPTS } from '../../client/src/features/learning/guides/inf1003/scripts.generated.js';
import { BAI_1_LESSON } from '../../client/src/features/learning/guides/inf1003/bai-1.js';
import { BAI_1_MACOS_LESSON } from '../../client/src/features/learning/guides/inf1003/bai-1-macos.js';
import { parseLabResult } from '../../src/modules/learning/lab-result.js';

const options = { baseUrl: 'https://example.com/guides/inf1003/', directory: "C:\\Năm 3\\O'Brien\\lab1", platform: 'windows', scriptHash: 'a'.repeat(64), bootstrapHash: 'b'.repeat(64) };
const fields = { STATUS: 'READY', REGION: 'ap-southeast-1', FE_IP: '203.0.113.10', BE_IP: '10.0.2.5', DB_ENDPOINT: 'bdu-db.example.ap-southeast-1.rds.amazonaws.com', FE_KEY_PATH: "/c/Năm 3/O'Brien/lab1/bdu-key-fe.pem", BE_KEY_PATH: "/c/Năm 3/O'Brien/lab1/bdu-key-be.pem", KEY_SOURCE: 'LOCAL' };
const token = (values) => 'BDU-LAB-V1:' + Buffer.from(Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('')).toString('base64');

describe('local AWS setup', () => {
  it.each([[BAI_1_LESSON, 'windows'], [BAI_1_MACOS_LESSON, 'macos']])('adapts infrastructure, keys and cleanup while preserving the OS deployment lesson', (original, platform) => {
    const before = JSON.stringify(original);
    const lesson = adaptLesson(original, 'local', platform);
    expect(lesson.steps).toHaveLength(7);
    expect(lesson.steps[1].blocks).toContainEqual({ type: 'local-bootstrap', action: 'start' });
    expect(lesson.steps[1].blocks[0]).toMatchObject({ type: 'region' });
    expect(lesson.steps[6].blocks).toContainEqual({ type: 'local-bootstrap', action: 'clean' });
    expect(lesson.steps[2].blocks.some(block => block.type === 'key-downloads')).toBe(false);
    for (const index of [0, 3, 4, 5]) expect(lesson.steps[index]).toEqual(original.steps[index]);
    expect(JSON.stringify(original)).toBe(before);
    expect(adaptLesson(original, 'cloudshell', platform)).toBe(original);
  });

  it('encodes the exact Windows Unicode path and verifies both downloaded scripts', () => {
    const command = bootstrapCommand(options);
    expect(command).toMatch(/^powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand /);
    const source = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le');
    expect(source).toContain("-LabDirectory 'C:\\Năm 3\\O''Brien\\lab1'");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('/guides/inf1003/scripts/start-aws-local.ps1');
    expect(source).toContain('-Action start');
    const clean = Buffer.from(bootstrapCommand({ ...options, action: 'clean' }).split(' ').at(-1), 'base64').toString('utf16le');
    expect(clean).toContain('-Action clean');
    expect(source).not.toContain('Invoke-Expression');
  });

  it('passes the chosen region to both bootstrap scripts and rejects invalid ones', () => {
    const mac = bootstrapCommand({ ...options, platform: 'macos', directory: '/Users/ten/lab1', region: 'ap-northeast-1' });
    expect(mac).toContain("'ap-northeast-1'");
    const windows = Buffer.from(bootstrapCommand({ ...options, region: 'ap-northeast-1' }).split(' ').at(-1), 'base64').toString('utf16le');
    expect(windows).toContain("-AwsRegion 'ap-northeast-1'");
    for (const region of ['Singapore', 'ap-southeast-1; rm -rf ~', '']) {
      expect(() => bootstrapCommand({ ...options, region })).toThrow();
    }
    // No region keeps the documented Singapore default.
    const fallback = Buffer.from(bootstrapCommand(options).split(' ').at(-1), 'base64').toString('utf16le');
    expect(fallback).toContain("-AwsRegion 'ap-southeast-1'");
  });

  it('builds macOS commands and rejects unsafe origins and incompatible paths', () => {    const command = bootstrapCommand({ ...options, platform: 'macos', directory: "/Users/ten/Năm 3/O'Brien/lab1" });
    expect(command).toContain('/bin/bash -c ');
    expect(command).toContain('shasum -a 256');
    expect(command).toContain('/guides/inf1003/scripts/start-aws-local.sh');
    for (const patch of [{ baseUrl: 'file:///C:/site/' }, { baseUrl: 'http://example.com/' }, { bootstrapHash: 'bad' }, { platform: 'macos' }, { directory: 'C:\\lab1;bad' }]) {
      expect(() => bootstrapCommand({ ...options, ...patch })).toThrow();
    }
    expect(() => bootstrapCommand({ ...options, baseUrl: 'http://localhost:3000/guides/inf1003/' })).not.toThrow();
  });

  it('matches downloadable scripts with generated checksums and CloudShell copies', () => {
    for (const [name, hash] of Object.entries(GUIDE_LOCAL_META)) {
      const file = readFileSync(resolve(process.cwd(), 'public/guides/inf1003/scripts', name));
      expect(createHash('sha256').update(file).digest('hex')).toBe(hash);
      if (name.startsWith('01-')) expect(GUIDE_SCRIPTS.start).toBe(file.toString('utf8'));
      if (name.startsWith('03-')) expect(GUIDE_SCRIPTS.clean).toBe(file.toString('utf8'));
    }
  });

  it.each(['macos', 'windows'])('generates %s create and cleanup commands for the Tailscale origin', (platform) => {
    for (const action of ['start', 'clean']) {
      for (const host of ['100.69.225.60:4304', '100.64.0.0', '100.127.255.255']) {
        const command = bootstrapCommand({ ...options, platform, action, baseUrl: `http://${host}/guides/inf1003/`, directory: platform === 'macos' ? '/Users/ban/lab1' : options.directory });
        const source = platform === 'windows' ? Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le') : command;
        expect(source).toContain(`http://${host}/guides/inf1003/scripts/start-aws-local.`);
        expect(source).toContain(platform === 'macos' ? ` ${action}` : `-Action ${action}`);
      }
    }
    for (const host of ['100.63.255.255', '100.128.0.0', '100.69.225.60.evil.test', '100.69.225.60@evil.test']) {
      expect(() => bootstrapCommand({ ...options, baseUrl: `http://${host}/guides/inf1003/` })).toThrow();
    }
  });

  it.each(['/c/Năm 3/O\'Brien/lab1', '/Users/đạt/Documents/lab1'])('accepts UTF-8 local result paths from %s', (directory) => {
    const values = { ...fields, FE_KEY_PATH: `${directory}/bdu-key-fe.pem`, BE_KEY_PATH: `${directory}/bdu-key-be.pem` };
    expect(parseLabResult(token(values))).toMatchObject(values);
    expect(labKeySource(token(values))).toBe('LOCAL');
  });

  it('keeps CloudShell tokens compatible and rejects unknown sources and unsafe paths', () => {
    const { KEY_SOURCE, ...cloud } = fields;
    cloud.FE_KEY_PATH = '/home/cloudshell/bdu-key-fe.pem';
    cloud.BE_KEY_PATH = '/home/cloudshell/bdu-key-be.pem';
    expect(parseLabResult(token(cloud))).toMatchObject(cloud);
    expect(labKeySource(token(cloud))).toBe('CLOUDSHELL');
    for (const patch of [{ KEY_SOURCE: 'REMOTE' }, { FE_KEY_PATH: '/c/lab/../bdu-key-fe.pem' }, { FE_KEY_PATH: '/c/$(whoami)/bdu-key-fe.pem' }]) {
      expect(() => parseLabResult(token({ ...fields, ...patch }))).toThrow();
    }
  });
});
