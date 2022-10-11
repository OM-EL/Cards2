import React from "react";
import * as THREE from "three";
import { Canvas, GroupProps, ThreeEvent, useFrame } from "@react-three/fiber";
import {
  useSpringRef,
  useSpring,
  animated,
  useSprings
} from "@react-spring/three";
import create from "zustand";
import { useGesture } from "@use-gesture/react";
import { useControls } from "leva";
import { CardGeometry } from "./three/geometry";
import "./styles.css";

//////////////////////////////////////////////////////////////
// Types and a data store for card state                    //
//////////////////////////////////////////////////////////////

// A react ref for tracking mouse position
interface MouseRef {
  position: {
    x: number;
    y: number;
  };
  hoverPosition: {
    x: number;
    y: number;
  };
  object?: THREE.Object3D;
}

// A react ref for tracking dragging of an object
interface DragRef {
  x: number;
  y: number;
  vX: number; // velocity in px / ms
  vY: number; // velocity in px / ms
  dX: number; // direction
  dY: number; // direction
  i?: number;
  dragging: boolean;
  dragged: boolean;
  object?: THREE.Object3D;
}

interface CardType {
  flip: boolean;
  lift?: number;
}

interface Store {
  cards: CardType[];
  setCards: (i: number) => void;
  focus: number;
  flip: (i: number) => void;
  setFocus: (i: number) => void;
  bump: (i: number) => void;
}

// A zustand store
const useStore = create<Store>((set) => ({
  cards: [],
  focus: 0,
  setCards: (i: number) => {
    set((state) => {
      state.setFocus(0);
      return {
        cards: Array.apply(null, { length: i }).map(() => ({ flip: false }))
      };
    });
  },
  setFocus: (i: number) => set(() => ({ focus: i })),
  flip: (i: number) =>
    set((state) => {
      state.bump(i);
      const cards = state.cards;
      cards[i].flip = !cards[i].flip;
      return { cards };
    }),
  bump: (i: number) => {
    set((state) => {
      const cards = state.cards;
      cards[i].lift = 4.5;
    });
    setTimeout(
      () =>
        set((state) => {
          const cards = state.cards;
          cards[i].lift = 0;
        }),
      100
    );
  }
}));

////////////////////////////////////////////////////////////////
// Some configuration and utils                               //
////////////////////////////////////////////////////////////////

const defaultCardCount = 4;

// My swooshy default animation spring parameters for tarot cards
const cardSpringConf = {
  mass: 10,
  tension: 300,
  friction: 85
};

// A snappier spring for card movement
const cardMovementSpringConf = {
  mass: 10,
  tension: 1000,
  friction: 150,
  damping: 500
};

// Get the nth decimal from a float
function nthDigit(ntn: number, number: number) {
  // var len = Math.floor(Math.log(number) / Math.LN10) - ntn;
  // return (number / Math.pow(10, len)) % 10 | 0;
  // Note: this could probably be more efficient
  return Number(number.toString().split(".")[1][ntn]);
}

// Augment rotation based on mouse position
function hoverTilt(baseRotation: [number, number, number], mouse: MouseRef) {
  if (!mouse.object) return baseRotation;
  var bbox = new THREE.Box3().setFromObject(mouse.object);
  const mX =
    mouse.hoverPosition.x >= 0
      ? mouse.hoverPosition.x / bbox.max.x
      : -mouse.hoverPosition.x / bbox.min.x;
  const mY =
    mouse.hoverPosition.y >= 0
      ? mouse.hoverPosition.y / bbox.max.y
      : -mouse.hoverPosition.y / bbox.min.y;
  return [
    baseRotation[0] + mY * THREE.MathUtils.degToRad(5),
    baseRotation[1] + -mX * THREE.MathUtils.degToRad(10),
    baseRotation[2],
    "ZXY"
  ];
}

// Augment rotation based on drag velocity
function dragTilt(
  baseRotation: [number, number, number],
  drag: DragRef,
  factor = 1,
  rangeFactor = 1
) {
  const { vX, vY, dX, dY } = drag;
  return [
    THREE.MathUtils.clamp(
      baseRotation[0] + vY * dY * factor,
      -0.25 * rangeFactor,
      0.25 * rangeFactor
    ),
    THREE.MathUtils.clamp(
      baseRotation[1] + vX * dX * factor,
      -0.25 * rangeFactor,
      0.25 * rangeFactor
    ),
    baseRotation[2]
  ];
}

// Simple layout parameters for the focused card
const focusCardLayout = {
  position: [0, 1, 0.2],
  scale: [0.75, 0.75, 0.75],
  rotation: [0, 0, 0]
};

// Math to layout the other cards
function cardsLayout(
  i: number,
  focus: number,
  cards: CardType[],
  hover: boolean[],
  mouse: MouseRef
) {
  const num = cards.length - 1;
  const height = num * 0.05;
  const width = num * 0.6;
  const tilt = num * 0.005;
  const j = i > focus ? i - 1 : i;
  const phase = num === 1 ? 0 : j / (num - 1) - 0.5;
  return {
    scale: [0.4, 0.4, 0.4],
    position: [
      phase * width,
      -2.25 - Math.abs(phase * height) + (hover[i] ? 0.1 : 0),
      phase * 0.01 + (hover[i] ? 0.2 : 0)
    ],
    rotation: hover[i]
      ? hoverTilt([0, 0, -phase * Math.PI * tilt], mouse)
      : [0, 0, -phase * Math.PI * tilt],
    config: cardMovementSpringConf
  };
}

////////////////////////////////////////////////////////////////
// Tarot card mesh things                                     //
////////////////////////////////////////////////////////////////

// So that we can reuse one geometry instance for all cards
function useCardGeometry() {
  const geometry = React.useRef<THREE.ShapeGeometry>(CardGeometry());
  return geometry.current;
}

// To force a fake loading delay, so that we can feel our loading animations
const Timeout = React.lazy(() => {
  return new Promise<any>((resolve) => {
    setTimeout(() => resolve({ default: () => <></> }), 1000 * Math.random());
  });
});

// A tarot card mesh group component
interface CardProps extends GroupProps {
  flip?: boolean;
  lift?: number;
}
function Card({
  flip,
  lift,
  onPointerEnter,
  onPointerLeave,
  ...props
}: CardProps) {
  const geometry = useCardGeometry();
  const mesh = React.useRef<THREE.Mesh>();
  const spring = useSpringRef();

  // Initialize spring animated parameters
  // We start the card transparent and down a little bit
  const springProps = useSpring({
    ref: spring,
    opacity: 0,
    position: [0, -0.5, 0],
    config: cardSpringConf
  });

  // Loading animation when component mounts
  React.useEffect(() => {
    spring.start({
      from: { opacity: 0, position: [0, -0.5, 0] },
      to: { opacity: 1, position: [0, 0, 0] },
      config: cardSpringConf
    });
  }, [spring]);

  // Lift and rotate the card based on props
  React.useEffect(() => {
    spring.start({
      rotation: [0, flip ? 0 : Math.PI, 0],
      position: [0, 0, lift || 0],
      config: cardSpringConf
    });
  }, [spring, flip, lift]);

  // Let people toggle wireframes mode for debugging
  const { wireframe } = useControls({
    wireframe: false
  });

  return (
    <animated.group {...props}>
      <animated.mesh
        {...springProps}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        geometry={geometry}
        ref={mesh}
        castShadow
        receiveShadow
      >
        <animated.meshPhongMaterial
          transparent
          opacity={springProps.opacity}
          color={"#555"}
          wireframe={wireframe}
        />
      </animated.mesh>
    </animated.group>
  );
}

// I found that, for some reason, handling suspense in a wrapper fixed some animations.
function SuspendedCard(props: CardProps) {
  return (
    <React.Suspense fallback={<></>}>
      <Timeout />
      <Card {...props} />
    </React.Suspense>
  );
}

// A surface to go under our cards
function Table(props: GroupProps) {
  return (
    <group {...props}>
      <mesh rotation={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 10]} />
        <meshStandardMaterial color={"#333"} />
      </mesh>
    </group>
  );
}

//////////////////////////////////////////////////////////////////////
// The primary scene!                                               //
//////////////////////////////////////////////////////////////////////

function Scene() {
  // Scene state
  const { cards, setCards, focus, flip, setFocus } = useStore();
  const [hover, setHover] = React.useState<boolean[]>(Array(cards.length));

  const { cardCount } = useControls({
    cardCount: {
      value: defaultCardCount,
      step: 1,
      min: 1,
      max: 10
    }
  });

  React.useEffect(() => setCards(cardCount), [cardCount]);

  // Rebuild hover state when cards array changes
  React.useEffect(() => setHover(Array(cards.length)), [cards]);

  // Clock for frame by frame animation
  const clock = React.useRef({
    tick: 0, // An arbitrary tick counter (unused atm)
    lastTick: 0,
    tps: 30, // Ticks per second
    elapsed: 0, // Time elapsed
    prevElapsed: 0, // Previous frame time elapsed
    animOffset: 0 // Time spend hover, for smooth pausing
  });

  // Other references
  const scene = React.useRef<THREE.Scene>();
  const mouse = React.useRef<MouseRef>({
    hoverPosition: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    object: undefined
  });
  const drag = React.useRef<DragRef>({
    x: 0,
    y: 0,
    vX: 0,
    vY: 0,
    dX: 0,
    dY: 0,
    object: undefined,
    dragging: false,
    dragged: false
  });

  // Control UI for ticks per second
  const [{ tps, debugOnFrame }, setConf] = useControls(() => ({
    tps: clock.current.tps,
    debugOnFrame: false
  }));

  // Initialize spring animation interpolators with initial layouts
  const [springs, springApi] = useSprings(cards.length, (i) => {
    if (i === focus) return focusCardLayout;
    else return cardsLayout(i, focus, cards, hover, mouse.current);
  });

  ////////////////////////////////////////////////////////////////////
  // The main animation loop                                        //
  ////////////////////////////////////////////////////////////////////

  useFrame((state) => {
    // Store a ref to the scene
    if (!scene.current) scene.current = state.scene;

    // Update the clock
    const t = state.clock.getElapsedTime();
    const c = clock.current;
    c.prevElapsed = c.elapsed;
    c.elapsed = t;
    c.tps = tps;

    // Update mouse position
    mouse.current.position.x = state.mouse.x;
    mouse.current.position.y = state.mouse.y;

    // Count clock ticks
    if (t - c.lastTick > c.tps) {
      c.lastTick = t;
      c.tick++;
    }

    // Limit mesh/spring updates based on ticks per second
    if (!(c.elapsed - c.lastTick >= 1 / c.tps)) return;

    // Make an object being dragged follow the mouse
    if (drag.current.dragging) {
      springApi.start((i) => {
        if (i === drag.current.i) {
          return {
            position: [
              (state.mouse.x * state.viewport.width) / 3,
              (state.mouse.y * state.viewport.height) / 3,
              1
            ],
            rotation: dragTilt([0, 0, 0], drag.current),
            config: cardMovementSpringConf
          };
        }
      });
    }

    // Apply interactivity (hover tilt) to focus card
    else if (hover[focus]) {
      springApi.start((i) => {
        if (i === focus) {
          return {
            config: cardSpringConf,
            rotation: hoverTilt([0, 0, 0], mouse.current),
            scale: [0.85, 0.85, 0.85]
          };
        } else {
          return cardsLayout(i, focus, cards, hover, mouse.current);
        }
      });
    }

    // Pause the focus card animation loop while hovering or dragging
    if (focus === drag.current.i || hover[focus]) {
      // Track time spent with focus animation paused to prevent jumpy states
      c.animOffset += c.elapsed - c.prevElapsed;
    }

    // Play the focus card animation loop
    else {
      // A constant to enable an animation cycle based on the sine of elapsed time
      const speed = 0.33;
      const cycle = Math.sin((c.elapsed - c.animOffset) * speed);

      // Trigger a card flip at a certain point in the cycle
      // I.e. when moving from the 90% cycle frame to the 91% cycle frame
      if (c.elapsed > 5 && cycle > 0 && nthDigit(0, cycle) === 9) {
        const prevCycle = Math.sin((c.prevElapsed - c.animOffset) * speed);
        if (nthDigit(1, cycle) === 1 && nthDigit(1, prevCycle) === 0) {
          flip(focus);
        }
      }

      // Animate the focus card to its new position
      springApi.start((i) => {
        if (i !== focus) return;
        return Object.assign({}, focusCardLayout, {
          position: [
            cycle * 1,
            focusCardLayout.position[1] +
              Math.sin(clock.current.elapsed * 2) * 0.025,
            focusCardLayout.position[2] + Math.abs(cycle * 0.25)
          ],
          rotation: [0, cycle * -Math.PI * 0.05, 0],
          config: cardSpringConf
        });
      });
    }

    // Animate the other cards to their position in the layout
    if (!drag.current.dragging) {
      springApi.start((i) => {
        if (i === focus) return;
        if (drag.current.dragging && drag.current.i === i) return;
        return cardsLayout(i, focus, cards, hover, mouse.current);
      });
    }

    // Debug on next frame
    if (debugOnFrame) {
      setConf({ debugOnFrame: false });
      debugger;
    }
  });

  // We use useGesture to handle most (but not all) of the user input events
  const bindGestures = useGesture(
    {
      // Capture mouse pos and velocity while dragging
      onDrag: ({
        args: [i],
        velocity: [vX, vY],
        direction: [dX, dY],
        event
      }) => {
        const e = (event as unknown) as ThreeEvent<MouseEvent>;
        event.stopPropagation();
        // Updating drag target here would "hot swap" drag objects
        // drag.current.i = i;
        drag.current.x = e.point.x; // threejs units
        drag.current.y = e.point.y; // threejs units
        drag.current.vX = vX; // px / ms
        drag.current.vY = vY; // px / ms
        drag.current.dX = dX;
        drag.current.dY = dY;
      },
      // Track an object being dragged
      onDragStart({ args: [i] }) {
        drag.current.i = i;
        drag.current.dragging = true;
        drag.current.dragged = true;
      },
      // Track an object being dropped
      onDragEnd({ args: [i] }) {
        // Let the user change the focus by dropping a card on the table
        if (drag.current.i && mouse.current.position.y > -0.3)
          setFocus(drag.current.i);
        drag.current.dragging = false;
        drag.current.i = undefined;
      },
      // Track mouse pos while hovering an object
      onMove({ event }) {
        const e = (event as unknown) as ThreeEvent<MouseEvent>;
        mouse.current.hoverPosition.x = e.point.x;
        mouse.current.hoverPosition.y = e.point.y;
        mouse.current.object = e.eventObject;
      }
    },
    {
      drag: {
        threshold: [10, 10]
      }
    }
  );

  // useGesture doesn't cover everything we need, so we have some handlers in react
  const bindReactGestures = (i: number) => ({
    // Change or flip focus on click
    onClick: (e: MouseEvent) => {
      e.stopPropagation(); // Prevent events on more than one mesh
      // Don't trigger the click handler after a drag event
      if (drag.current.dragged) {
        drag.current.dragged = false;
        return;
      }
      // Flip the focus card on click
      if (focus === i) {
        flip(focus);
      }
      // Set focus on a card on click
      else {
        setFocus(i);
      }
      // Clear hover states on click
      setHover(hover.map((x) => false));
    },
    // Track hover states
    onPointerOver: (e: MouseEvent) => {
      e.stopPropagation(); // Prevent events on more than one mesh
      const n = [...hover.map((x) => false)];
      n.splice(i, 1, true);
      setHover(n);
    },
    // Track hover states
    onPointerOut: (e: MouseEvent) => {
      e.stopPropagation(); // Prevent events on more than one mesh
      const n = [...hover];
      n.splice(i, 1, false);
      setHover(n);
    }
  });

  return (
    <group name="preview">
      <group name="preview-cards" position={[0, 0, 0.1]}>
        {cards.map((card, i) => {
          const springProps = springs[i];
          return (
            <animated.group
              {...bindGestures(i)}
              {...bindReactGestures(i)}
              key={`card${i}`}
              name={`card${i}`}
            >
              <SuspendedCard
                {...springProps}
                flip={cards[i].flip}
                lift={cards[i].lift}
              />
            </animated.group>
          );
        })}
      </group>
      <Table position={[0, 0, 0]} receiveShadow />
      <directionalLight
        intensity={0.25}
        position={[0, 1, 3]}
        castShadow
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
        shadow-camera-far={10}
        shadow-camera-near={0}
        shadow-camera-bottom={-5}
        shadow-camera-top={5}
        shadow-camera-right={5}
        shadow-camera-left={-5}
      />
      <ambientLight intensity={0.75} />
    </group>
  );
}

// Happy little root
export default function App() {
  return (
    <Canvas
      shadows={{
        enabled: true,
        type: THREE.PCFSoftShadowMap
      }}
      dpr={window.devicePixelRatio}
    >
      <Scene />
    </Canvas>
  );
}
