/**
 * Styles Module Exports
 */

export {
    type StyleProfile,
    type NamingConvention,
    STYLE_PROFILES,
    DEFAULT_PROFILE,
    defaultProfileFor,
    getProfile,
    listProfiles
} from './profiles.js';

export {
    detectStyle,
    type DetectedStyle,
    type StylePattern
} from './detector.js';
