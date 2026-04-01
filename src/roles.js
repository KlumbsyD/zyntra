const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const STATE_DIR = process.env.STATE_DIR || '/data';
const ROLES_FILE = path.join(STATE_DIR, 'dj-roles.json');

/**
 * DJ-restricted commands — these require the DJ role (if one is set).
 * Play and queue-viewing commands are always open to everyone.
 */
const DJ_COMMANDS = new Set([
  'skip', 'stop', 'pause', 'resume', 'volume',
  'shuffle', 'loop', 'disconnect', 'album', 'playlist',
]);

function loadRoles() {
  try {
    if (!fs.existsSync(ROLES_FILE)) return {};
    return JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveRoles(roles) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
  } catch (err) {
    logger.error('Failed to save DJ roles:', err);
  }
}

function getDJRoleId(guildId) {
  const roles = loadRoles();
  return roles[guildId] || null;
}

function setDJRoleId(guildId, roleId) {
  const roles = loadRoles();
  roles[guildId] = roleId;
  saveRoles(roles);
}

function clearDJRole(guildId) {
  const roles = loadRoles();
  delete roles[guildId];
  saveRoles(roles);
}

/**
 * Returns true if the member is allowed to run the command.
 * Logic:
 *  - If no DJ role is set for this guild → everyone can do everything
 *  - If a DJ role is set:
 *    - Non-DJ commands (play, search, queue, nowplaying) → always allowed
 *    - DJ commands → requires DJ role OR server admin / Manage Channels permission
 */
function canUseDJCommand(member, commandName, guildId) {
  if (!DJ_COMMANDS.has(commandName)) return true;

  const djRoleId = getDJRoleId(guildId);
  if (!djRoleId) return true; // no restriction configured

  // Admins and users with Manage Channels always bypass
  if (
    member.permissions.has('Administrator') ||
    member.permissions.has('ManageChannels')
  ) return true;

  return member.roles.cache.has(djRoleId);
}

module.exports = { canUseDJCommand, getDJRoleId, setDJRoleId, clearDJRole, DJ_COMMANDS };
