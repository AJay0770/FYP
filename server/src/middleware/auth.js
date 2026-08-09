const jwt = require('jsonwebtoken');

const verifyJWT = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Access token required' });

  const user = verifyJWT(token, process.env.JWT_SECRET);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
};

/**
 * Header-or-query-param auth, for endpoints consumed by browser elements that
 * cannot set an Authorization header — specifically <img src> pointing at an
 * MJPEG stream.
 *
 * Deliberately NOT the default: a token in the query string leaks into server
 * access logs, browser history, and Referer headers. Only mount this on routes
 * that genuinely cannot use the header, and prefer issuing a short-lived,
 * stream-scoped token rather than passing the session access token here.
 */
const authenticateTokenAllowQuery = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

  if (!token) return res.status(401).json({ error: 'Access token required' });

  const user = verifyJWT(token, process.env.JWT_SECRET);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
};

const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

module.exports = { authenticateToken, authenticateTokenAllowQuery, authorizeRole, verifyJWT };
