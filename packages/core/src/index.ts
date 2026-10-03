export {
  configSchema,
  parseConfig,
  loadConfigFile,
  resolveViewport,
  resolveOutputSize,
  defaultOutputName,
  ConfigError,
  PRESETS,
  type Config,
  type ConfigInput,
  type PresetName,
} from './config.js';
export { EASINGS, EASING_NAMES, type EasingName } from './easing.js';
export { checkFfmpeg, encoderArgs, extractPoster, ffmpegBinary, FfmpegError, FrameEncoder } from './ffmpeg.js';
export {
  record,
  browserStatus,
  RecordAbortedError,
  AUTO_SECTION_SELECTOR,
  type RecordOptions,
  type RecordResult,
  type Progress,
} from './recorder.js';
export { buildTimeline, scrollAt, frameCount, normalizeStops, type Timeline, type Segment } from './timeline.js';
