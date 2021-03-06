import Request from 'superagent'
import {
  RECORDER_INIT,
  PERMISSION_RESOLVED,
  PERMISSION_DENIED,
  START_RECORD,
  STOP_RECORD,
  START_PREVIEW,
  START_UPLOAD,
  SUCCEEDED_UPLOAD,
  FAILED_UPLOAD,
  ON_TOGGLED_PREREC
} from '../actions/RecorderActions'
import {logger} from "../../util/logger";

navigator.getUserMedia = (
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia
);

const {debug, error} = logger("recordUpload");
const audioContext = new AudioContext();
const BUFFER_SIZE = 4096;
const SAMPLE_RATE = audioContext.sampleRate;
const PREREC_SEC = 10;
let localMediaStream;
let preRecAudioBufferArray = [];
let tempPreRecArray = [];
let audioBufferArray = [];
let mediaStreamSource;
let preRecScriptProcessor;
let scriptProcessor;
let previewBufferSource;

const willStart = () => {
  if (previewBufferSource) previewBufferSource.stop();
  mediaStreamSource = audioContext.createMediaStreamSource(localMediaStream)
};

const startPreRec = () => {
  willStart();
  preRecScriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  mediaStreamSource.connect(preRecScriptProcessor);
  preRecAudioBufferArray = [];
  preRecScriptProcessor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    if (preRecAudioBufferArray.length * BUFFER_SIZE > SAMPLE_RATE * PREREC_SEC) {
      preRecAudioBufferArray.shift()
    }
    preRecAudioBufferArray.push(new Float32Array(channel))
  };
  preRecScriptProcessor.connect(audioContext.destination)
};

const stopPreRec = () => {
  preRecScriptProcessor.disconnect();
  if (localMediaStream) {
    const stop = localMediaStream.stop;
    stop && stopPreRec()
  }
};

//BUG? プレビュー中に録音するのを何回か繰り返すと音声が乱れる
const start = () => {
  if (preRecAudioBufferArray.length > 1) {
    stopPreRec();
    tempPreRecArray = [];
    tempPreRecArray = preRecAudioBufferArray.concat()
  }
  willStart();
  scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  mediaStreamSource.connect(scriptProcessor);
  audioBufferArray = [];
  scriptProcessor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    audioBufferArray.push(new Float32Array(channel))
  };
  scriptProcessor.connect(audioContext.destination)
};

const stop = () => {
  scriptProcessor.disconnect();
  if (localMediaStream) {
    const stop = localMediaStream.stop;
    stop && stop()
  }
  if (preRecAudioBufferArray.length > 1) {
    startPreRec()
  }
};

const getAudioBuffer = (_audioBufferArray) => {
  let buffer = audioContext.createBuffer(
      1,
      _audioBufferArray.length * BUFFER_SIZE,
      SAMPLE_RATE
  );
  let channel = buffer.getChannelData(0);
  for (let i = 0, imax = _audioBufferArray.length; i < imax; i = (i + 1) | 0) {
    for (let j = 0, jmax = BUFFER_SIZE; j < jmax; j = (j + 1) | 0) {
      channel[i * BUFFER_SIZE + j] = _audioBufferArray[i][j];
    }
  }
  return buffer;
};

const encodeWAV = (samples, sampleRate) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (view, offset, string) => {
    for (let i = 0, offs = offset | 0, max = string.length | 0; i < max; i = (i + 1) | 0) {
      view.setUint8(offs + i, string.charCodeAt(i))
    }
  };
  const floatTo16BitPCM = (output, offset, input) => {
    for (let i = 0; i < input.length; i = (i + 1) | 0, offset = (offset + 2) | 0) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
  };
  writeString(view, 0, 'RIFF'); // RIFFヘッダ
  view.setUint32(4, 32 + samples.length * 2, true); // これ以降のファイルサイズ
  writeString(view, 8, 'WAVE'); // WAVEヘッダ
  writeString(view, 12, 'fmt '); // fmtチャンク
  view.setUint32(16, 16, true); // fmtチャンクのバイト数
  view.setUint16(20, 1, true); // フォーマットID
  view.setUint16(22, 1, true); // チャンネル数
  view.setUint32(24, sampleRate, true); // サンプリングレート
  view.setUint32(28, sampleRate * 2, true); // データ速度
  view.setUint16(32, 2, true); // ブロックサイズ
  view.setUint16(34, 16, true); // サンプルあたりのビット数
  writeString(view, 36, 'data'); // dataチャンク
  view.setUint32(40, samples.length * 2, true); // 波形データのバイト数
  floatTo16BitPCM(view, 44, samples); // 波形データ
  return view
};

//TODO encodeMP3

const mergeBuffers = () => {
  const buffer = [...tempPreRecArray, ...audioBufferArray];
  let i, j, max, imax, jmax;
  let sampleLength = 0;
  for (i = 0, max = buffer.length; i < max; i = (i + 1) | 0) {
    sampleLength = (sampleLength + buffer[i].length) | 0
  }
  const samples = new Float32Array(sampleLength);
  let sampleIdx = 0;
  for (i = 0, imax = buffer.length; i < imax; i = (i + 1) | 0) {
    for (j = 0, jmax = buffer[i].length; j < jmax; j = (j + 1) | 0) {
      samples[sampleIdx] = buffer[i][j];
      sampleIdx = (sampleIdx + 1) | 0
    }
  }
  return samples
};

const exportBlob = () => {
  const dataview = encodeWAV(mergeBuffers(), SAMPLE_RATE);
  return new Blob([dataview], {
    type: 'audio/wav'
  })
};

const preview = () => {
  if (previewBufferSource) previewBufferSource.stop();
  const src = audioContext.createBufferSource();
  const buffer = [...tempPreRecArray, ...audioBufferArray];
  debug(buffer.length * BUFFER_SIZE / SAMPLE_RATE);
  /* TODOO durationをサーバにも送る？ */
  src.buffer = getAudioBuffer(buffer);
  src.connect(audioContext.destination);
  src.start();
  previewBufferSource = src
};

const request = (success, fail) => {
  navigator.getUserMedia({
    video: false,
    audio: true
  }, success, fail)
};

export const requestPermission = store => next => action => {
  if (action.type !== RECORDER_INIT) {
    return next(action)
  }
  next(action);
  //TODO if navigator.getUserMedia === undefined => alert このブラウザでは利用できません
  request(
      (_localMediaStream) => {
        localMediaStream = _localMediaStream;
        store.dispatch({type: PERMISSION_RESOLVED})
      }, (err) => {
        alert('マイクの利用を許可してください');
        store.dispatch({type: PERMISSION_DENIED})
      }
  )
};
//TODO 起動中にpermission deniedになった場合どうするか

export const recorder = store => next => action => {
  switch (action.type) {
    case ON_TOGGLED_PREREC:
      if (action.isPreRec) {
        startPreRec();
        next(action);
        return
      }
      stopPreRec();
      preRecAudioBufferArray = [];
      next(action);
      return;
    case START_RECORD:
      setTimeout(start(), 50);
      next(action);
      return;
    case STOP_RECORD:
      stop();
      next(action);
      return;
    case START_PREVIEW:
      preview();
      next(action);
      return;
    default:
      return next(action)
  }
};

export const uploader = store => next => action => {
  debug(`uploader ${action.type}`);
  //actionを発行するのは誰だっけ？
  if (action.type !== START_UPLOAD) {
    return next(action)
  }
  const gyaonId = action.gyaonId;
  const formData = new FormData();
  formData.append("file", exportBlob(), "hoge.wav");
  if (action.location !== undefined) {
    formData.append("lat", action.location.lat);
    formData.append("lon", action.location.lon);
  }
  debug(`アップロード開始: /upload/${gyaonId}`);
  Request
      .post('/upload/' + gyaonId)
      .set('form')
      .send(formData)
      .then(res => {
        store.dispatch({
          type: SUCCEEDED_UPLOAD,
          data: res.data
        })
      })
      .catch(err => {
        error(`failed to upload: ${err}`);
        store.dispatch({type: FAILED_UPLOAD})
      });
  next(action)
};
