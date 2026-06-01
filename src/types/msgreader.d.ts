declare module 'msgreader' {
  class MsgReader {
    constructor(buffer: Buffer | ArrayBuffer);
    getFileData(): Record<string, any>;
  }
  export default MsgReader;
}
