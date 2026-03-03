// EIOS local-only axios instance — no cloud auth needed
import Axios from 'axios'

export const axios = Axios.create({ baseURL: '/' })

axios.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
)
