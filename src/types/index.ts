/**
 * Converter options for converting various file formats to Markdown
 */
export interface ConverterOptions {
  /** Name of the file (helpful for buffer inputs) */
  fileName?: string;
  /** Force a specific file extension for processing */
  forceExtension?: string;
  /** Original URL (used for web content like YouTube or Bing search) */
  url?: string;
}

/**
 * Input type for converter - can be file path, base64 string, or buffer
 */
export type ConverterInput = string | Buffer;

/**
 * Supported file extensions
 */
export enum FileExtension {
  PDF = '.pdf',
  DOCX = '.docx',
  HTML = '.html',
  HTM = '.htm',
  TXT = '.txt',
  IPYNB = '.ipynb',
  XML = '.xml',
  RSS = '.rss',
  ATOM = '.atom',
  XLSX = '.xlsx',
  XLS = '.xls',
  CSV = '.csv',
  MP3 = '.mp3',
  WAV = '.wav',
  PPTX = '.pptx',
  ZIP = '.zip',
  JPG = '.jpg',
  JPEG = '.jpeg',
  PNG = '.png',
  GIF = '.gif',
  JSON = '.json',
  YAML = '.yaml',
  YML = '.yml',
  EPUB = '.epub',
  MSG = '.msg',
}

/**
 * Turndown service options for HTML to Markdown conversion
 */
export interface TurndownOptions {
  headingStyle: 'setext' | 'atx';
  hr: string;
  bulletListMarker: string;
  codeBlockStyle: 'indented' | 'fenced';
  emDelimiter: string;
  keepHeaderLevels?: boolean;
}

/**
 * Image metadata interface
 */
export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  size?: number;
}

/**
 * Audio metadata interface
 */
export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  bitrate?: number;
}

/**
 * Result of file type detection
 */
export interface FileTypeResult {
  ext: string;
  mime: string;
}

/**
 * A single item for batch conversion
 */
export interface BatchInput {
  /** File path, base64 data URL, or Buffer */
  input: ConverterInput;
  /** Optional converter options (e.g. forceExtension) */
  options?: ConverterOptions;
}

/**
 * Result for a single batch conversion item
 */
export interface BatchResult {
  /** Input identifier — file path if string, 'buffer' for Buffer inputs */
  inputId: string;
  /** Converted Markdown content, present on success */
  result?: string;
  /** Error message, present on failure */
  error?: string;
}
