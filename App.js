import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Vibration,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  Alert,
} from 'react-native';
import {
  AudioSession,
  LiveKitRoom,
  useLocalParticipant,
  registerGlobals,
} from '@livekit/react-native';
import BackgroundService from 'react-native-background-actions';
import io from 'socket.io-client';

// Initialize native WebRTC globals
registerGlobals();

// Replace with your Node.js signaling URL & LiveKit Cloud WebSocket URL
const SOCKET_SERVER_URL = 'https://your-node-server.onrender.com';
const LIVEKIT_URL = 'wss://your-project.livekit.cloud';

const socket = io(SOCKET_SERVER_URL, { autoConnect: false });

// Persistent background task so Android never sleeps or kills the audio socket
const keepAliveTask = async () => {
  await new Promise(() => {});
};

const bgOptions = {
  taskName: 'WalkieTalkieBgService',
  taskTitle: 'Walkie-Talkie Connected',
  taskDesc: 'Listening for live voice (works while screen is locked)',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#10B981',
};

// ---------------- THEME PALETTES ----------------
const THEMES = {
  dark: {
    bg: '#090D16',
    surface: '#111827',
    inputBg: '#090D16',
    border: '#1F2937',
    text: '#F9FAFB',
    subtext: '#9CA3AF',
    muted: '#4B5563',
    ready: '#10B981',      // Emerald
    talking: '#EF4444',    // Crimson
    incoming: '#3B82F6',   // Electric Blue
  },
  light: {
    bg: '#F3F4F6',
    surface: '#FFFFFF',
    inputBg: '#F9FAFB',
    border: '#E5E7EB',
    text: '#111827',
    subtext: '#6B7280',
    muted: '#9CA3AF',
    ready: '#059669',
    talking: '#DC2626',
    incoming: '#2563EB',
  },
};

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const theme = isDark ? THEMES.dark : THEMES.light;

  // Login & Room State
  const [inRoom, setInRoom] = useState(false);
  const [isHosting, setIsHosting] = useState(false);
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [password, setPassword] = useState('');
  const [rtcToken, setRtcToken] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggleTheme = () => {
    Vibration.vibrate(15);
    setIsDark((prev) => !prev);
  };

  const handleLoginAndConnect = async () => {
    if (!username.trim() || !roomId.trim() || !password.trim()) {
      Alert.alert('Missing Details', 'Please enter your name, room ID, and password.');
      return;
    }

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Microphone Required', 'Please grant mic permission to use Push-to-Talk.');
        return;
      }
    }

    const cleanRoom = roomId.trim().toUpperCase();
    const cleanUser = username.trim();

    // OFFLINE UI TEST MODE: Type 'DEMO' as room code to test UI instantly without server
    if (SOCKET_SERVER_URL.includes('your-node-server') || cleanRoom === 'DEMO') {
      Vibration.vibrate(25);
      await BackgroundService.start(keepAliveTask, bgOptions);
      setRtcToken('DEMO_MODE');
      setRoomId(cleanRoom);
      setInRoom(true);
      return;
    }

    setLoading(true);
    Vibration.vibrate(25);

    socket.connect();
    const action = isHosting ? 'create_room' : 'join_room';

    socket.emit(
      action,
      { roomId: cleanRoom, password, username: cleanUser },
      async (res) => {
        setLoading(false);
        if (res?.error) {
          socket.disconnect();
          Alert.alert('Access Denied', res.error);
          return;
        }

        // Force speakerphone output & start lock-screen foreground service
        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ['speaker', 'bluetooth', 'headset'],
            audioTypeOptions: {
              manageAudioFocus: true,
              audioMode: 'inCommunication',
            },
          },
        });
        await AudioSession.startAudioSession();
        await BackgroundService.start(keepAliveTask, bgOptions);

        setRtcToken(res.rtcToken);
        setRoomId(cleanRoom);
        setInRoom(true);
      }
    );
  };

  const handleLeaveRoom = async () => {
    Vibration.vibrate(25);
    socket.disconnect();
    await AudioSession.stopAudioSession();
    await BackgroundService.stop();
    setRtcToken(null);
    setInRoom(false);
  };

  // ---------------- SCREEN 1: LOGIN & ROOM ACCESS ----------------
  if (!inRoom || !rtcToken) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={theme.bg}
        />

        {/* Top Bar with Theme Switcher */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={[styles.liveDot, { backgroundColor: theme.ready }]} />
            <Text style={[styles.brandTitle, { color: theme.text }]}>VOX</Text>
          </View>

          <Pressable
            onPress={toggleTheme}
            style={[
              styles.themeToggle,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.themeToggleText, { color: theme.text }]}>
              {isDark ? '☀ LIGHT' : '☾ DARK'}
            </Text>
          </Pressable>
        </View>

        {/* Login Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={[styles.segmentedControl, { backgroundColor: theme.inputBg }]}>
            <Pressable
              style={[
                styles.segmentBtn,
                !isHosting && { backgroundColor: theme.surface },
              ]}
              onPress={() => {
                Vibration.vibrate(15);
                setIsHosting(false);
              }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: !isHosting ? theme.text : theme.subtext },
                ]}
              >
                JOIN ROOM
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.segmentBtn,
                isHosting && { backgroundColor: theme.surface },
              ]}
              onPress={() => {
                Vibration.vibrate(15);
                setIsHosting(true);
              }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: isHosting ? theme.text : theme.subtext },
                ]}
              >
                HOST ROOM
              </Text>
            </Pressable>
          </View>

          <TextInput
            placeholder="Your Callsign (Username)"
            placeholderTextColor={theme.muted}
            value={username}
            onChangeText={setUsername}
            style={[
              styles.input,
              {
                backgroundColor: theme.inputBg,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />

          <TextInput
            placeholder="Room Name (Type DEMO to test offline)"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            value={roomId}
            onChangeText={setRoomId}
            style={[
              styles.input,
              {
                backgroundColor: theme.inputBg,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />

          <TextInput
            placeholder="Room Password"
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={[
              styles.input,
              {
                backgroundColor: theme.inputBg,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />

          <Pressable
            disabled={loading}
            onPress={handleLoginAndConnect}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: theme.ready },
              (pressed || loading) && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {loading
                ? 'CONNECTING...'
                : isHosting
                ? 'CREATE & ENTER ROOM'
                : 'JOIN ROOM'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.footerNote, { color: theme.muted }]}>
          GLOBAL INTERNET WALKIE-TALKIE • WORKS ON WI-FI & 5G
        </Text>
      </KeyboardAvoidingView>
    );
  }

  // ---------------- SCREEN 2: LIVE WALKIE-TALKIE SCREEN ----------------
  if (rtcToken === 'DEMO_MODE') {
    return (
      <WalkieTalkieMain
        roomId={roomId}
        username={username.trim()}
        theme={theme}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return (
    <LiveKitRoom
      serverUrl={LIVEKIT_URL}
      token={rtcToken}
      connect={true}
      audio={false}
      video={false}
    >
      <WalkieTalkieMain
        roomId={roomId}
        username={username.trim()}
        theme={theme}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onLeave={handleLeaveRoom}
      />
    </LiveKitRoom>
  );
}

// ---------------- MAIN WALKIE-TALKIE INTERFACE ----------------
function WalkieTalkieMain({
  roomId,
  username,
  theme,
  isDark,
  onToggleTheme,
  onLeave,
}) {
  let localParticipant = null;
  try {
    localParticipant = useLocalParticipant()?.localParticipant;
  } catch (e) {
    // Demo Mode fallback
  }

  const [isHoldingMic, setIsHoldingMic] = useState(false);
  const [incomingSpeaker, setIncomingSpeaker] = useState(null);

  // Button press scale animation
  const buttonScale = useRef(new Animated.Value(1)).current;

  // Outgoing Hold-to-Talk Wave Animations (3 concentric waves)
  const waveAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  // Incoming Voice 5-Dot Expanding Animation
  const dotAnims = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  // Listen for who is talking in the room
  useEffect(() => {
    const handleSpeakerUpdate = ({ activeSpeaker }) => {
      if (activeSpeaker && activeSpeaker !== username) {
        Vibration.vibrate(20);
        setIncomingSpeaker(activeSpeaker);
      } else {
        setIncomingSpeaker(null);
      }
    };

    socket.on('speaker_update', handleSpeakerUpdate);
    return () => socket.off('speaker_update', handleSpeakerUpdate);
  }, [username]);

  // 1. Outgoing Wave Animation when Mic Button is Held
  useEffect(() => {
    let loops = [];
    if (isHoldingMic) {
      loops = waveAnims.map((anim, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(index * 550),
            Animated.timing(anim, {
              toValue: 1,
              duration: 1650,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        )
      );
      loops.forEach((loop) => loop.start());
    } else {
      waveAnims.forEach((anim) => {
        anim.stopAnimation();
        anim.setValue(0);
      });
    }
    return () => loops.forEach((loop) => loop.stop());
  }, [isHoldingMic]);

  // 2. Five-Dot Expanding Animation when Incoming Voice is Heard
  useEffect(() => {
    let dotLoops = [];
    if (incomingSpeaker && !isHoldingMic) {
      const targetScales = [2.2, 3.4, 4.2, 3.0, 2.0];
      const speeds = [260, 200, 170, 220, 280];

      dotLoops = dotAnims.map((anim, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: targetScales[i],
              duration: speeds[i],
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 1,
              duration: speeds[i],
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        )
      );
      dotLoops.forEach((loop) => loop.start());
    } else {
      dotAnims.forEach((anim) => {
        anim.stopAnimation();
        Animated.spring(anim, {
          toValue: 1,
          useNativeDriver: true,
        }).start();
      });
    }
    return () => dotLoops.forEach((loop) => loop.stop());
  }, [incomingSpeaker, isHoldingMic]);

  // Finger Presses & Holds the Circular Mic Button
  const handleMicPressIn = async () => {
    if (incomingSpeaker) {
      Vibration.vibrate([0, 35, 50, 35]);
      return;
    }

    Vibration.vibrate(40);
    setIsHoldingMic(true);

    Animated.spring(buttonScale, {
      toValue: 0.92,
      useNativeDriver: true,
    }).start();

    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(true);
    }
    socket.emit('toggle_mic', { roomId, username, talking: true });
  };

  // Finger Releases the Circular Mic Button
  const handleMicPressOut = async () => {
    if (!isHoldingMic) return;

    Vibration.vibrate(25);
    setIsHoldingMic(false);

    Animated.spring(buttonScale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();

    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(false);
    }
    socket.emit('toggle_mic', { roomId, username, talking: false });
  };

  const activeColor = isHoldingMic
    ? theme.talking
    : incomingSpeaker
    ? theme.incoming
    : theme.ready;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      {/* Top Header: Room Pill + Theme Switcher + Leave Button */}
      <View style={styles.topBar}>
        <View
          style={[
            styles.roomBadge,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: activeColor }]} />
          <Text style={[styles.roomCodeText, { color: theme.text }]}>
            {roomId}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={onToggleTheme}
            style={[
              styles.themeToggle,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.themeToggleText, { color: theme.text }]}>
              {isDark ? '☀' : '☾'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onLeave}
            style={[
              styles.leaveBtn,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.leaveText, { color: theme.talking }]}>
              EXIT
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Incoming Voice Area + 5-Dot Expanding Animation */}
      <View style={styles.incomingSection}>
        <Text style={[styles.statusLabel, { color: activeColor }]}>
          {isHoldingMic
            ? '● TRANSMITTING VOICE'
            : incomingSpeaker
            ? `🔊 ${incomingSpeaker.toUpperCase()} IS SPEAKING`
            : 'CHANNEL STANDBY'}
        </Text>

        <View style={styles.fiveDotContainer}>
          {dotAnims.map((anim, idx) => (
            <Animated.View
              key={idx}
              style={[
                styles.voiceDot,
                {
                  backgroundColor: incomingSpeaker
                    ? theme.incoming
                    : theme.border,
                  transform: [{ scaleY: anim }],
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Center Giant Circular Hold-to-Talk Button + Expanding Wave Rings */}
      <View style={styles.micArena}>
        {waveAnims.map((anim, idx) => (
          <Animated.View
            key={idx}
            pointerEvents="none"
            style={[
              styles.waveRing,
              {
                borderColor: theme.talking,
                transform: [
                  {
                    scale: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 2.05],
                    }),
                  },
                ],
                opacity: anim.interpolate({
                  inputRange: [0, 0.6, 1],
                  outputRange: [0.65, 0.25, 0],
                }),
              },
            ]}
          />
        ))}

        <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
          <Pressable
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            disabled={Boolean(incomingSpeaker)}
            style={[
              styles.bigMicButton,
              {
                backgroundColor: isHoldingMic ? theme.talking : theme.surface,
                borderColor: activeColor,
                shadowColor: activeColor,
              },
            ]}
          >
            <Text
              style={[
                styles.micIconText,
                { color: isHoldingMic ? '#FFFFFF' : activeColor },
              ]}
            >
              {incomingSpeaker ? '🔊' : '🎙️'}
            </Text>
            <Text
              style={[
                styles.micMainLabel,
                { color: isHoldingMic ? '#FFFFFF' : theme.text },
              ]}
            >
              {incomingSpeaker
                ? 'LISTENING'
                : isHoldingMic
                ? 'RELEASE TO MUTE'
                : 'HOLD TO TALK'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>

      {/* Test Toggle to Preview the 5-Dot Incoming Voice Animation */}
      <Pressable
        onPress={() => {
          Vibration.vibrate(20);
          setIncomingSpeaker((prev) => (prev ? null : 'PRANAV'));
        }}
        style={[
          styles.testBtn,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.testBtnText, { color: theme.subtext }]}>
          {incomingSpeaker
            ? '⏹ STOP INCOMING VOICE TEST'
            : '▶ TEST 5-DOT INCOMING VOICE'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 24,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1,
  },
  themeToggleText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  card: {
    width: '100%',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 11,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  input: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
    borderWidth: 1,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  roomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  roomCodeText: {
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  leaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1,
  },
  leaveText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  incomingSection: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 22,
  },
  fiveDotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    gap: 10,
  },
  voiceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  micArena: {
    width: 300,
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
  },
  bigMicButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 5,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 16,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  micIconText: {
    fontSize: 42,
    marginBottom: 8,
  },
  micMainLabel: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
  },
  testBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 100,
    borderWidth: 1,
  },
  testBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  footerNote: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
});