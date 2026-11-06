import type { BufferLike } from '../../src/audio/backend';
import { FakeBackend } from './fakeBackend';

/** FakeBackend + decodeAudioData (the plain FakeBackend has none, so SamplePlayer stays disabled in every older test). Each decode returns a buffer of `samplesPerFile` samples. */
export class SampleBackend extends FakeBackend {
  decodeCalls: Array<{ bytes: number; rate: number | undefined }> = [];
  failDecode = false;
  samplesPerFile = 250_000; // 1 MB of float32 per file
  async decodeAudioData(data: ArrayBuffer, rate?: number): Promise<BufferLike> {
    this.decodeCalls.push({ bytes: data.byteLength, rate });
    if (this.failDecode) throw new Error('EncodingError');
    return { getChannelData: () => new Float32Array(1), length: this.samplesPerFile, numberOfChannels: 1, sampleRate: rate ?? this.sampleRate };
  }
}
