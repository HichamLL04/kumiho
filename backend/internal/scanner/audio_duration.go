package scanner

import (
	"encoding/binary"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// getAudioDuration 오디오 파일의 재생 시간(초)을 반환합니다.
// ffprobe가 설치되어 있으면 우선 사용하고, 없으면 순수 Go 파싱으로 폴백합니다.
func getAudioDuration(filePath string) *float64 {
	// 1. ffprobe 시도
	if dur := getAudioDurationFFprobe(filePath); dur != nil {
		return dur
	}

	// 2. 순수 Go 파싱 폴백
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".mp3":
		return getMP3Duration(filePath)
	case ".m4a", ".m4b", ".mp4", ".aac":
		return getMP4Duration(filePath)
	case ".flac":
		return getFLACDuration(filePath)
	case ".ogg", ".oga":
		return getOGGDuration(filePath)
	case ".wav":
		return getWAVDuration(filePath)
	}
	return nil
}

// ffprobe를 사용하여 duration을 가져옵니다.
func getAudioDurationFFprobe(filePath string) *float64 {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		filePath,
	)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	durStr := strings.TrimSpace(string(out))
	dur, err := strconv.ParseFloat(durStr, 64)
	if err != nil || dur <= 0 {
		return nil
	}
	return &dur
}

// MP3 duration: MPEG 오디오 프레임 헤더 파싱
// CBR: 첫 프레임 비트레이트로 전체 파일 크기에서 계산
// VBR (Xing/VBRI): 헤더에서 총 프레임 수를 읽어 계산
func getMP3Duration(filePath string) *float64 {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil
	}
	fileSize := info.Size()

	// ID3v2 태그 스킵
	offset := skipID3v2(f)
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return nil
	}

	// 첫 번째 유효 MPEG 프레임 찾기
	header, headerOffset := findMPEGFrame(f, offset, fileSize)
	if header == 0 {
		return nil
	}

	version := (header >> 19) & 3 // 00=2.5, 01=reserved, 10=2, 11=1
	layer := (header >> 17) & 3   // 01=III, 10=II, 11=I
	bitrateIdx := (header >> 12) & 15
	sampleIdx := (header >> 10) & 3

	if version == 1 || layer == 0 || bitrateIdx == 0 || bitrateIdx == 15 || sampleIdx == 3 {
		return nil
	}

	bitrate := getMPEGBitrate(version, layer, int(bitrateIdx))
	sampleRate := getMPEGSampleRate(version, int(sampleIdx))
	if bitrate == 0 || sampleRate == 0 {
		return nil
	}

	samplesPerFrame := getMPEGSamplesPerFrame(version, layer)

	// Xing/VBRI VBR 헤더 확인
	frameSize := getMP3FrameSize(bitrate, sampleRate, layer, header)
	if frameSize > 0 {
		frameBuf := make([]byte, frameSize)
		if _, err := f.Seek(headerOffset, io.SeekStart); err == nil {
			if _, err := io.ReadFull(f, frameBuf); err == nil {
				if totalFrames := parseXingFrames(frameBuf); totalFrames > 0 {
					dur := float64(totalFrames) * float64(samplesPerFrame) / float64(sampleRate)
					return &dur
				}
			}
		}
	}

	// CBR 폴백: 파일 크기와 비트레이트로 계산
	audioSize := fileSize - headerOffset
	dur := float64(audioSize) * 8.0 / float64(bitrate*1000)
	if dur > 0 {
		return &dur
	}
	return nil
}

func skipID3v2(f *os.File) int64 {
	var buf [10]byte
	if _, err := f.ReadAt(buf[:], 0); err != nil {
		return 0
	}
	if string(buf[:3]) != "ID3" {
		return 0
	}
	size := int64(buf[6]&0x7f)<<21 | int64(buf[7]&0x7f)<<14 | int64(buf[8]&0x7f)<<7 | int64(buf[9]&0x7f)
	return size + 10
}

func findMPEGFrame(f *os.File, offset, fileSize int64) (uint32, int64) {
	buf := make([]byte, 4)
	limit := offset + 64*1024 // 최대 64KB 내에서 탐색
	if limit > fileSize {
		limit = fileSize
	}
	for pos := offset; pos < limit-3; pos++ {
		if _, err := f.ReadAt(buf, pos); err != nil {
			return 0, 0
		}
		header := binary.BigEndian.Uint32(buf)
		if header&0xFFE00000 == 0xFFE00000 { // sync word
			return header, pos
		}
	}
	return 0, 0
}

var mpegBitrateTable = [5][16]int{
	// MPEG1 Layer I
	{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0},
	// MPEG1 Layer II
	{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},
	// MPEG1 Layer III
	{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},
	// MPEG2/2.5 Layer I
	{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0},
	// MPEG2/2.5 Layer II/III
	{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
}

func getMPEGBitrate(version, layer uint32, idx int) int {
	var tableIdx int
	if version == 3 { // MPEG1
		switch layer {
		case 3:
			tableIdx = 0 // Layer I
		case 2:
			tableIdx = 1 // Layer II
		case 1:
			tableIdx = 2 // Layer III
		default:
			return 0
		}
	} else { // MPEG2, MPEG2.5
		switch layer {
		case 3:
			tableIdx = 3 // Layer I
		case 2, 1:
			tableIdx = 4 // Layer II/III
		default:
			return 0
		}
	}
	return mpegBitrateTable[tableIdx][idx]
}

var mpegSampleRateTable = [4][3]int{
	{44100, 48000, 32000}, // MPEG1
	{22050, 24000, 16000}, // MPEG2
	{11025, 12000, 8000},  // MPEG2.5
	{0, 0, 0},             // reserved
}

func getMPEGSampleRate(version uint32, idx int) int {
	var vIdx int
	switch version {
	case 3:
		vIdx = 0
	case 2:
		vIdx = 1
	case 0:
		vIdx = 2
	default:
		return 0
	}
	return mpegSampleRateTable[vIdx][idx]
}

func getMPEGSamplesPerFrame(version, layer uint32) int {
	if version == 3 { // MPEG1
		switch layer {
		case 3:
			return 384 // Layer I
		case 2:
			return 1152 // Layer II
		case 1:
			return 1152 // Layer III
		}
	} else { // MPEG2/2.5
		switch layer {
		case 3:
			return 384 // Layer I
		case 2:
			return 1152 // Layer II
		case 1:
			return 576 // Layer III
		}
	}
	return 1152
}

func getMP3FrameSize(bitrate, sampleRate int, layer, header uint32) int {
	padding := int((header >> 9) & 1)
	if layer == 3 { // Layer I
		return (12*bitrate*1000/sampleRate + padding) * 4
	}
	return 144*bitrate*1000/sampleRate + padding
}

func parseXingFrames(frameBuf []byte) int {
	// Xing 또는 Info 헤더 찾기
	for _, tag := range []string{"Xing", "Info"} {
		idx := -1
		for i := 0; i < len(frameBuf)-4; i++ {
			if string(frameBuf[i:i+4]) == tag {
				idx = i
				break
			}
		}
		if idx >= 0 && idx+8 <= len(frameBuf) {
			flags := binary.BigEndian.Uint32(frameBuf[idx+4 : idx+8])
			if flags&1 != 0 && idx+12 <= len(frameBuf) { // FRAMES flag
				return int(binary.BigEndian.Uint32(frameBuf[idx+8 : idx+12]))
			}
		}
	}
	return 0
}

// MP4/M4A/M4B duration: mvhd atom에서 duration과 timescale 읽기
func getMP4Duration(filePath string) *float64 {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil
	}
	fileSize := info.Size()

	return findMP4MvhdDuration(f, 0, fileSize)
}

func findMP4MvhdDuration(f *os.File, offset, limit int64) *float64 {
	buf := make([]byte, 8)
	pos := offset
	for pos < limit-8 {
		if _, err := f.ReadAt(buf, pos); err != nil {
			return nil
		}
		atomSize := int64(binary.BigEndian.Uint32(buf[:4]))
		atomType := string(buf[4:8])

		if atomSize < 8 {
			if atomSize == 1 {
				// 64-bit extended size
				var ext [8]byte
				if _, err := f.ReadAt(ext[:], pos+8); err != nil {
					return nil
				}
				atomSize = int64(binary.BigEndian.Uint64(ext[:]))
			} else {
				break
			}
		}

		switch atomType {
		case "moov", "trak", "mdia":
			// 컨테이너 atom: 내부 탐색
			if dur := findMP4MvhdDuration(f, pos+8, pos+atomSize); dur != nil {
				return dur
			}
		case "mvhd":
			return parseMvhd(f, pos+8, atomSize-8)
		case "mdhd":
			// mdhd도 duration 정보를 가지고 있음 (트랙별)
			if dur := parseMdhd(f, pos+8, atomSize-8); dur != nil {
				return dur
			}
		}

		pos += atomSize
	}
	return nil
}

func parseMvhd(f *os.File, offset, size int64) *float64 {
	if size < 20 {
		return nil
	}
	buf := make([]byte, size)
	if _, err := f.ReadAt(buf, offset); err != nil {
		return nil
	}
	version := buf[0]
	var timescale, duration uint64
	if version == 0 {
		if len(buf) < 20 {
			return nil
		}
		timescale = uint64(binary.BigEndian.Uint32(buf[12:16]))
		duration = uint64(binary.BigEndian.Uint32(buf[16:20]))
	} else {
		if len(buf) < 28 {
			return nil
		}
		timescale = uint64(binary.BigEndian.Uint32(buf[20:24]))
		duration = uint64(binary.BigEndian.Uint64(buf[24:32]))
	}
	if timescale == 0 {
		return nil
	}
	dur := float64(duration) / float64(timescale)
	if dur > 0 {
		return &dur
	}
	return nil
}

func parseMdhd(f *os.File, offset, size int64) *float64 {
	if size < 20 {
		return nil
	}
	buf := make([]byte, size)
	if _, err := f.ReadAt(buf, offset); err != nil {
		return nil
	}
	version := buf[0]
	var timescale, duration uint64
	if version == 0 {
		if len(buf) < 20 {
			return nil
		}
		timescale = uint64(binary.BigEndian.Uint32(buf[12:16]))
		duration = uint64(binary.BigEndian.Uint32(buf[16:20]))
	} else {
		if len(buf) < 28 {
			return nil
		}
		timescale = uint64(binary.BigEndian.Uint32(buf[20:24]))
		duration = uint64(binary.BigEndian.Uint64(buf[24:32]))
	}
	if timescale == 0 {
		return nil
	}
	dur := float64(duration) / float64(timescale)
	if dur > 0 {
		return &dur
	}
	return nil
}

// FLAC duration: STREAMINFO 메타데이터 블록에서 읽기
func getFLACDuration(filePath string) *float64 {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	// fLaC 마커 확인
	var marker [4]byte
	if _, err := io.ReadFull(f, marker[:]); err != nil {
		return nil
	}
	if string(marker[:]) != "fLaC" {
		return nil
	}

	// STREAMINFO 블록 헤더 (4바이트)
	var blockHeader [4]byte
	if _, err := io.ReadFull(f, blockHeader[:]); err != nil {
		return nil
	}

	blockSize := int(blockHeader[1])<<16 | int(blockHeader[2])<<8 | int(blockHeader[3])
	if blockSize < 34 {
		return nil
	}

	buf := make([]byte, blockSize)
	if _, err := io.ReadFull(f, buf); err != nil {
		return nil
	}

	// STREAMINFO: bytes 10-17 contain sample rate (20 bits) + channels (3 bits) + bits per sample (5 bits) + total samples (36 bits)
	sampleRate := int(buf[10])<<12 | int(buf[11])<<4 | int(buf[12])>>4
	totalSamples := int64(buf[13]&0x0F)<<32 | int64(buf[14])<<24 | int64(buf[15])<<16 | int64(buf[16])<<8 | int64(buf[17])

	if sampleRate == 0 || totalSamples == 0 {
		return nil
	}
	dur := float64(totalSamples) / float64(sampleRate)
	if dur > 0 {
		return &dur
	}
	return nil
}

// OGG Vorbis duration: 마지막 페이지의 granule position에서 계산
func getOGGDuration(filePath string) *float64 {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil
	}

	// 첫 페이지에서 샘플레이트 읽기
	sampleRate := getOGGSampleRate(f)
	if sampleRate == 0 {
		return nil
	}

	// 마지막 OGG 페이지에서 granule position 읽기
	granule := findLastOGGGranule(f, info.Size())
	if granule <= 0 {
		return nil
	}

	dur := float64(granule) / float64(sampleRate)
	if dur > 0 {
		return &dur
	}
	return nil
}

func getOGGSampleRate(f *os.File) int {
	// 첫 OGG 페이지를 건너뛰고 두 번째 페이지(Vorbis 헤더 등)에서 샘플레이트 찾기
	// 실제로는 첫 페이지의 payload에서 Vorbis identification header를 읽음
	buf := make([]byte, 256)
	if _, err := f.ReadAt(buf, 0); err != nil {
		return 0
	}

	// OGG capture pattern 확인
	if string(buf[:4]) != "OggS" {
		return 0
	}

	// 페이지 헤더: 26바이트 + segment table
	numSegments := int(buf[26])
	headerSize := 27 + numSegments
	if headerSize >= len(buf) {
		return 0
	}

	// Payload 시작
	payloadStart := headerSize
	if payloadStart+30 > len(buf) {
		return 0
	}

	payload := buf[payloadStart:]
	// Vorbis identification header: 0x01 + "vorbis"
	if len(payload) >= 30 && payload[0] == 1 && string(payload[1:7]) == "vorbis" {
		rate := binary.LittleEndian.Uint32(payload[12:16])
		return int(rate)
	}

	// Opus: "OpusHead"
	if len(payload) >= 12 && string(payload[:8]) == "OpusHead" {
		// Opus always uses 48000 for granule position
		return 48000
	}

	return 0
}

func findLastOGGGranule(f *os.File, fileSize int64) int64 {
	// 파일 끝에서 역방향으로 OGG 페이지 캡처 패턴 "OggS" 탐색
	searchSize := int64(65536)
	if searchSize > fileSize {
		searchSize = fileSize
	}
	buf := make([]byte, searchSize)
	offset := fileSize - searchSize
	if _, err := f.ReadAt(buf, offset); err != nil {
		return 0
	}

	// 뒤에서부터 "OggS" 찾기
	for i := len(buf) - 4; i >= 0; i-- {
		if string(buf[i:i+4]) == "OggS" {
			// granule position: 페이지 헤더 offset 6, 8바이트 little-endian
			if i+14 <= len(buf) {
				granule := int64(binary.LittleEndian.Uint64(buf[i+6 : i+14]))
				if granule > 0 {
					return granule
				}
			}
		}
	}
	return 0
}

// WAV duration: RIFF 헤더에서 계산
func getWAVDuration(filePath string) *float64 {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var buf [44]byte
	if _, err = io.ReadFull(f, buf[:]); err != nil {
		return nil
	}

	if string(buf[:4]) != "RIFF" || string(buf[8:12]) != "WAVE" {
		return nil
	}

	// fmt 청크에서 정보 추출
	// 일반적인 WAV: offset 22=channels, 24=sampleRate, 28=byteRate, 34=bitsPerSample
	byteRate := binary.LittleEndian.Uint32(buf[28:32])
	if byteRate == 0 {
		return nil
	}

	info, err := f.Stat()
	if err != nil {
		return nil
	}

	// data 청크 크기 찾기 (간단히 파일크기 - 헤더로 근사)
	dataSize := float64(info.Size() - 44)
	dur := dataSize / float64(byteRate)
	dur = math.Max(0, dur)
	if dur > 0 {
		return &dur
	}
	return nil
}
