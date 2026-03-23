export interface AmbientTrack {
  id: string;
  file: string; // 확장자 제외 파일명
}

export const AMBIENT_TRACKS: AmbientTrack[] = [
  { id: "rain", file: "rain-sound" },
  { id: "bonfire", file: "fire-crackling-sound" },
];
