import http from '@/axios/index.js';

export function oauthLinuxDoLogin(code, redirectUri) {
    return http.post('/oauth/linuxDo/login',{code, redirectUri})
}

export function oauthGithubLogin(code, redirectUri) {
    return http.post('/oauth/github/login',{code, redirectUri})
}

export function oauthGoogleLogin(code, redirectUri) {
    return http.post('/oauth/google/login',{code, redirectUri})
}

export function oauthPocketIdAuthorize(redirectUri) {
    return http.get('/oauth/pocketId/authorize', {params: {redirectUri}})
}

export function oauthPocketIdBindAuthorize(redirectUri) {
    return http.get('/my/pocketId/authorize', {params: {redirectUri}})
}

export function oauthPocketIdLogin(code, state, redirectUri) {
    return http.post('/oauth/pocketId/login',{code, state, redirectUri})
}

export function oauthBindUser(form) {
    return http.put('/oauth/bindUser', form)
}
