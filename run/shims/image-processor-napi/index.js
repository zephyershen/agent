function unavailable() {
  throw new Error('image-processor-napi is unavailable in this dev shim');
}

export const sharp = unavailable;
export default unavailable;

export function getNativeModule() {
  return {
    resize: unavailable,
    decode: unavailable,
    encode: unavailable,
  };
}

