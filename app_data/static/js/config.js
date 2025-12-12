export const CONFIG = {
    DEBUG: { 
        SHOW_HITBOXES: false, 
        LOG_NETWORK: true 
    },
    
    // --- GLOBAL FONTS ---
    FONTS: {
        SEPARATOR: "TaHoma", // Font Family for separators
        TRACKLIST_HEADER: "bold 50px TaHoma",
        TRACKLIST_BODY: "24px TaHoma"
    },

    SCENE: { 
        BG_TOP: '#222222',     
        BG_BOTTOM: '#050505',
        FOG: { color: 0x121212, near: 40, far: 300 } 
    },
    
    SCROLL: {
        DAMPING: 0.1,        
        SPEED_OVERVIEW: 0.005, 
        SPEED_BROWSE: 0.003,   
        ZOOM_SPEED: 0.05       
    },
    
    SORT_MODES: {
        ARTIST: 'ARTIST',
        ALBUM: 'ALBUM',
        RAW: 'RAW'
    },

GIMBAL: {
        SMOOTHING: 0.1, // Global smoothing factor
        
        // Default settings (used for Overview/Browse)
        DEFAULT: {
            SENSITIVITY: 0.005,
            LIMIT_AZIMUTH: 10, // Left/Right limit (radians)
            LIMIT_POLAR: 0.4,   // Up/Down limit range
            MIN_POLAR: 0.1,     // Lowest angle (overhead)
            MAX_POLAR: Math.PI / 2 // Highest angle (horizon)
        },

        // Specific settings for State 2 (View/Inspect)
        INSPECT: {
            SENSITIVITY: 0.005,
            LIMIT_AZIMUTH: 0.2, // Allow wider looking around
            LIMIT_POLAR: 0.2,
            MIN_POLAR: 0.1,
            MAX_POLAR: Math.PI / 1.5 
        },

        // Specific settings for State 3 (Player)
        PLAYER: {
            SENSITIVITY: 0.004, // Slower, more precise
            LIMIT_AZIMUTH: 10, // Tighter focus on the turntable
            LIMIT_POLAR: 0.4,
            MIN_POLAR: 0.2,
            MAX_POLAR: Math.PI / 2.2
        }
    },
    CAMERA: {
        TRANSITION_SPEED: 0,
        BROWSE_OFFSET: { x: -30, y: 45, z: 0 }, 
        OVERVIEW_OFFSET: { x: 0, y: 30, z: 40 },

        STATES: {
            OVERVIEW: {
                pos: { x: 0, y: 30, z: 0 },
                look: { x: 0, y: 10, z: -80 },
                fov: 30,
                transitionTime: 0 
            },
            BROWSE: {
                pos: { x: 0, y: 0, z: 0 },
                look: { x: 100, y: 5, z: 0 },
                fov: 30,
                transitionTime: 0 
            },
            INSPECT: {
                pos: { x: 0, y: 0, z: 70 },
                look: { x: 0, y: 0, z: 100 },
                fov: 65,
                transitionTime: 0
            },
            PLAYER: {
                pos: { x: -75, y: 25, z: 10 },
                look: { x: -100, y: 0, z: 0 },
                fov: 30,
                transitionTime: 0
            }
        }
    },

    STATIONS: {
        OVERVIEW: { x: 0, y: 0, z: -100, ry: 0 },            
        BROWSE:   { x: 100, y: 0, z: 0, ry: -Math.PI / 2 },  
        INSPECT:  { x: 0, y: 0, z: 100, ry: -Math.PI },     
        PLAYER:   { x: -100, y: 0, z: 0, ry: -Math.PI * 1.5 } 
    },

    LIGHTS: { 
        AMBIENT: 0.9, 
        SPOT: 2.0, 
        DIRECTIONAL: 0.8 
    },

    CRATE: {
        SIZE: 50, 
        COLOR: 0x8B4513, 
        WIDTH: 8, HEIGHT: 5, DEPTH: 8,
        SPACING_X: 16, SPACING_Z: 0    
    },
    
    DIGGING: {
        SPACING: 0.6,         
        LIFT_HEIGHT: 6.0,     
        BASE_HEIGHT: 4.0,     
        SCROLL_SPEED: 0.003,
        
        ALBUM_THICKNESS: 0.1,
        SINGLE_THICKNESS: 0.1,
        
        SEPARATOR_HEIGHT: 10.3,
        SEPARATOR_THICKNESS: 0.1,
        SEPARATOR_COLOR: 0xffffff,
        SEPARATOR_TEXT_COLOR: '#000000',
        SEPARATOR_FONT_SIZE: 20, // Changed: Configurable Font Size
        
        SLEEVE_COLOR: 0xeeeeee,
        BOX_WIDTH: 11, BOX_HEIGHT: 7, BOX_DEPTH: 35, BOX_THICKNESS: 0.1   
    },
    
    // CHANGED: Added Transforms and Dimensions for Inspect View
    INSPECT_VIEW: {
        BG_COLOR: 0x1a1a1a,
        TEXT_COLOR: '#ffffff',
        ACCENT_COLOR: '#44aa88',
        
        // Dimensions of the 3D planes
        TRACKLIST_WIDTH: 12,
        TRACKLIST_HEIGHT: 20,
        
        TRANSFORMS: {
            COVER: { x: -8, y: 2, z: 0 },
            TRACKLIST: { x: 10, y: 2, z: 0 },
            
            // Discs spawn relative to this X, starting at Y start, animating to Y end
            DISC_SPACING_X: 6,
            DISC_START_Y: -25,
            DISC_END_Y: -12
        }
    },

    GATEFOLD: {
        OPEN_DURATION: 1500, 
        INNER_BG_COLOR: '#1a1a1a', 
        HEADER_COLOR: '#44aa88', 
        TEXT_COLOR: '#ffffff',      
        MAX_TRACKS_PER_SIDE: 8 
    },

    PLAYER: {
        BASE_COLOR: 0x222222,
        PLATTER_COLOR: 0x111111,
        CHROME_COLOR: 0xaaaaaa,
        DISC_COLOR: 0x050505,
        RADIUS_OUTER: 3.3,
        RADIUS_INNER: 1.2,
        ANIM_DISC_FLY: 1500,
        ANIM_ARM_MOVE: 1000,
        ANGLE_ARM_REST: 0,
        ANGLE_ARM_START: -0.42, 
        ANGLE_ARM_END: -0.83, 
        ROTATION_SPEED: 0.035,
        GROOVE_COLOR: '#151515',
        FOV_MIN: 10, 
        FOV_MAX: 75, 
        FOV_SPEED: 0.03
    }
};