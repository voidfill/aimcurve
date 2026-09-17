import { describe, expect, it } from 'vitest';
import { pickerSource } from '../src/source/picker';
import { uploadSource } from '../src/source/upload';

function directory(name: string, children: Record<string, unknown> = {}) {
  return {
    name,
    async getDirectoryHandle(child: string) {
      const found = children[child];
      if (!found) throw new DOMException('missing', 'NotFoundError');
      return found;
    },
  } as unknown as FileSystemDirectoryHandle;
}

function emptyDirectory(name: string) {
  return {
    name,
    async *keys() {},
  } as unknown as FileSystemDirectoryHandle;
}

function uploadFile(path: string): File {
  return {
    name: path.split('/').at(-1)!,
    webkitRelativePath: path,
    async text() { return ''; },
    async arrayBuffer() { return new ArrayBuffer(0); },
  } as File;
}

describe('source root name', () => {
  it('reads only the selected root direct children, never nested backups or other roots', async () => {
    const csv = uploadFile('Game/stats/Run Stats.csv');
    csv.text = async () => 'selected';
    const source = uploadSource([
      csv,
      uploadFile('Game/backup/stats/Run Stats.csv'),
      uploadFile('Game/backup/stats/Other Stats.csv'),
      uploadFile('Elsewhere/stats/Else Stats.csv'),
      uploadFile('Game/backup/performances/Run Performance.perf'),
    ]);
    expect(await source.list()).toEqual(['Run']);
    expect(await source.read('Run')).toEqual({ stats: 'selected' });
  });

  it('rejects ambiguous duplicate direct-child files', () => {
    expect(() => uploadSource([
      uploadFile('Game/stats/Run Stats.csv'),
      uploadFile('Game/stats/Run Stats.csv'),
    ])).toThrow(/duplicate/i);
  });

  it('does not accept a nested stats directory as the selected root stats directory', () => {
    expect(() => uploadSource([uploadFile('Game/backup/stats/Run Stats.csv')]))
      .toThrow('no stats/ directory');
  });
  it('uses the selected directory handle name for picker sources', async () => {
    const source = await pickerSource(directory('FPSAimTrainer', {
      stats: emptyDirectory('stats'),
    }));

    expect(source.rootName).toBe('FPSAimTrainer');
  });

  it('uses the first relative-path segment for upload sources', () => {
    const source = uploadSource([
      uploadFile('PortableInstall/stats/Run Stats.csv'),
    ]);

    expect(source.rootName).toBe('PortableInstall');
  });
});
