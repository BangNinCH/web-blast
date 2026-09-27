import { getToken } from './api.js'

let socket = null

export const connectSocket = () => {
  if (socket?.connected) return socket

  socket = io({ auth: { token: getToken() } })
  return socket
}

export const getSocket = () => socket
