export type DocErrorCode =
  | 'DOC_INVALID'
  | 'DOC_ENCRYPTED'
  | 'DOC_LIMIT_EXCEEDED'
  | 'DOC_UNSUPPORTED';

export class DocConversionError extends Error {
  readonly code: DocErrorCode;

  constructor(code: DocErrorCode, message: string) {
    super(message);
    this.name = 'DocConversionError';
    this.code = code;
  }
}