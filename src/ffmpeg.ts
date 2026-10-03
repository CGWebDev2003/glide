import { spawn, type ChildProcess } from 'node:child_process';

export class FfmpegError extends Error {}

export function ffmpegBinary(): string {
  return process.env.SCROLLREEL_FFMPEG || process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Throws a readable error when ffmpeg is missing or lacks the needed encoder. */
export async function checkFfmpeg(encoder: string): Promise<string> {
  const bin = ffmpegBinary();
  const out = await new Promise<string>((resolve, reject) => {
    let buf = '';
    let p: ChildProcess;
    try {
      p = spawn(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    p.stdout!.on('data', (d) => (buf += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(buf) : reject(new Error(`exit code ${code}`))));
  }).catch((e: NodeJS.ErrnoException) => {
    const hint =
      e.code === 'ENOENT'
        ? [
            `ffmpeg was not found ("${bin}").`,
            'Install it and make sure it is on your PATH:',
            '  macOS:          brew install ffmpeg',
            '  Ubuntu/Debian:  sudo apt install ffmpeg',
            '  Windows:        winget install Gyan.FFmpeg',
            'Or point scrollreel to a binary: SCROLLREEL_FFMPEG=/path/to/ffmpeg',
          ].join('\n')
        : `Could not run ffmpeg ("${bin}"): ${e.message}`;
    throw new FfmpegError(hint);
  });
  if (!new RegExp(`\\s${encoder}\\s`).test(out)) {
    throw new FfmpegError(`Your ffmpeg build has no "${encoder}" encoder. Install a full build (e.g. brew install ffmpeg).`);
  }
  return bin;
}

export interface EncoderOptions {
  output: string;
  fps: number;
  width: number;
  height: number;
  format: 'mp4' | 'webm';
  inputCodec: 'jpeg' | 'png';
  crf: number;
  preset: string;
}

export function encoderArgs(o: EncoderOptions): string[] {
  const scale =
    `scale=${o.width}:${o.height}:flags=lanczos+accurate_rnd+full_chroma_int` +
    `:out_color_matrix=bt709:out_range=tv,format=yuv420p`;
  const input = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(o.fps),
    '-c:v', o.inputCodec === 'jpeg' ? 'mjpeg' : 'png',
    '-i', '-',
    '-vf', scale,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  ];
  const codec =
    o.format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-profile:v', 'high',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      : ['-c:v', 'libvpx-vp9', '-crf', String(Math.min(63, o.crf + 14)), '-b:v', '0', '-row-mt', '1',
         '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'];
  return [...input, ...codec, '-r', String(o.fps), '-an', o.output];
}

/** Streams encoded frames into ffmpeg's stdin (no temp files). */
export class FrameEncoder {
  private proc: ChildProcess;
  private stderr = '';
  private exited: Promise<number>;
  private failed: Error | null = null;

  constructor(bin: string, o: EncoderOptions) {
    this.proc = spawn(bin, encoderArgs(o), { stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc.stderr!.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-8000);
    });
    this.proc.stdin!.on('error', (e) => {
      this.failed = e;
    });
    this.exited = new Promise((resolve) => {
      this.proc.on('error', (e) => {
        this.failed = e;
        resolve(-1);
      });
      this.proc.on('close', (code) => resolve(code ?? -1));
    });
  }

  async write(frame: Buffer): Promise<void> {
    if (this.failed) throw new FfmpegError(`ffmpeg failed: ${this.failed.message}\n${this.stderr}`);
    const stdin = this.proc.stdin!;
    if (!stdin.write(frame)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new FfmpegError(`ffmpeg exited early:\n${this.stderr}`)); };
        const cleanup = () => { stdin.off('drain', onDrain); this.proc.off('close', onClose); };
        stdin.on('drain', onDrain);
        this.proc.on('close', onClose);
      });
    }
  }

  async finish(): Promise<void> {
    this.proc.stdin!.end();
    const code = await this.exited;
    if (code !== 0) throw new FfmpegError(`ffmpeg exited with code ${code}:\n${this.stderr.trim()}`);
  }

  abort(): void {
    try { this.proc.stdin!.destroy(); } catch { /* ignore */ }
    this.proc.kill('SIGKILL');
  }
}
