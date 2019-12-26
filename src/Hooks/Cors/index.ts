/*
* @adonisjs/core
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import { ResponseContract } from '@ioc:Adonis/Core/Response'
import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import { CorsConfigContract } from '@ioc:Adonis/Core/Cors'
import { ServerContract } from '@ioc:Adonis/Core/Server'

/**
 * List of default exposed headers.
 */
const SIMPLE_EXPOSE_HEADERS = [
  'cache-control',
  'content-language',
  'content-type',
  'expires',
  'last-modified',
  'pragma',
]

/**
 * The Cors middleware class to handle preflight request as per the CORS
 * RFC https://www.w3.org/TR/cors/.
 *
 * This is a functional middleware and shared among all requests. So make
 * sure not to set request specific instance properties.
 */
export class Cors {
  private isEnabled: ((request) => boolean)

  constructor (private options: CorsConfigContract) {
    this.normalizeOptions()
  }

  /**
   * Normalize config options
   */
  private normalizeOptions () {
    /**
     * Convert all headers to lowercase
     */
    this.options.exposeHeaders = this.options.exposeHeaders.map((header) => header.toLowerCase())

    const hasExtraHeaders = this.options.exposeHeaders.find((header) => {
      return SIMPLE_EXPOSE_HEADERS.indexOf(header) === -1
    })

    /**
     * If expose headers doesn't have extra headers, then empty the list
     */
    if (!hasExtraHeaders) {
      this.options.exposeHeaders = []
    }

    /**
     * A pre-computed function to know if CORS is enabled for current request or not
     */
    if (typeof (this.options.enabled) === 'function') {
      this.isEnabled = this.options.enabled
    } else {
      this.isEnabled = () => this.options.enabled as boolean
    }
  }

  /**
   * Computes the origin for the current request based upon the
   * user config.
   *
   * Origin match is always case sensitive
   */
  private computeResponseOrigin (origin: string): string | null {
    let allowedOrigins = this.options.origin

    /**
     * If the `origin` value inside user config is a function, we
     * call that function and use the return value as the
     * new config value.
     */
    if (typeof (allowedOrigins) === 'function') {
      allowedOrigins = allowedOrigins(origin)
    }

    /**
     * If true, then allow the current origin
     */
    if (allowedOrigins === true) {
      return origin
    }

    /**
     * False, disallows all origins
     */
    if (allowedOrigins === false) {
      return null
    }

    /**
     * Wildcard allows the current origin. However, it also indicates
     * the browser that all origins are allowed.
     *
     * Fundamentaly `*` and `true` are not same, though they both allows
     * the same origin.
     */
    if (allowedOrigins === '*') {
      /**
       * Setting `Access-Control-Allow-Origin=*` along with `Access-Control-Allow-Credentials=true`
       * isn't allowed. So in that case, we return the value of the current origin and not the
       * wildcard identifier.
       */
      return this.options.credentials === true ? origin : '*'
    }

    /**
     * Find the matching origin, if value is an array
     */
    if (Array.isArray(allowedOrigins)) {
      if (allowedOrigins.find((allowedOrigin) => allowedOrigin === origin)) {
        return origin
      }
      return null
    }

    /**
     * Find the matching origin, if value is a comma seperated string
     */
    if (allowedOrigins.split(',').find((allowedOrigin) => allowedOrigin === origin)) {
      return origin
    }

    /**
     * Nothing is allowed
     */
    return null
  }

  /**
   * Returns an array of headers allowed based upon user config
   * and request headers.
   *
   * The array items are casted to lowercase for case insensitive
   * match.
  */
  private computedAllowedHeaders (headers: string[]): string[] {
    let allowedHeaders = this.options.headers

    /**
     * Compute allowed headers by calling the config function.
     */
    if (typeof (allowedHeaders) === 'function') {
      allowedHeaders = allowedHeaders(headers)
    }

    /**
     * Allow current set of headers, when `allowedHeaders = true`
     */
    if (allowedHeaders === true) {
      return headers.map((header) => header.toLowerCase())
    }

    /**
     * Disallow all headers
     */
    if (allowedHeaders === false) {
      return []
    }

    /**
     * Allow explicitly define headers as an array of comma seperated
     * string literal.
     */
    if (Array.isArray(allowedHeaders)) {
      return allowedHeaders.map((header) => header.toLowerCase())
    }

    return allowedHeaders.split(',').map((header) => header.toLowerCase())
  }

  /**
   * Sets the `Access-Control-Allow-Origin` header
   */
  private setOrigin (response: ResponseContract, allowedOrigin: string) {
    response.header('Access-Control-Allow-Origin', allowedOrigin)
  }

  /**
   * Setting `Access-Control-Expose-Headers` headers, when custom headers
   * are defined. If no custom headers are defined, then simple response
   * headers are used instead.
   */
  private setExposedHeaders (response: ResponseContract) {
    if (this.options.exposeHeaders.length) {
      response.header('Access-Control-Expose-Headers', this.options.exposeHeaders.join(','))
    }
  }

  /**
   * Allows `Access-Control-Allow-Credentials` when enabled inside the user
   * config.
   */
  private setCredentials (response: ResponseContract) {
    if (this.options.credentials === true) {
      response.header('Access-Control-Allow-Credentials', 'true')
    }
  }

  /**
   * Set `Access-Control-Allow-Methods` header.
   */
  private setAllowMethods (response: ResponseContract) {
    response.header('Access-Control-Allow-Methods', this.options.methods.join(','))
  }

  /**
   * Set `Access-Control-Allow-Headers` header.
   */
  private setAllowHeaders (response: ResponseContract, allowedHeaders: string[]) {
    response.header('Access-Control-Allow-Headers', allowedHeaders.join(','))
  }

  /**
   * Set `Access-Control-Max-Age` header.
   */
  private setMaxAge (response: ResponseContract) {
    if (this.options.maxAge) {
      response.header('Access-Control-Max-Age', this.options.maxAge)
    }
  }

  /**
   * Ends the preflight request with 204 status code
   */
  private endPreFlight (response: ResponseContract) {
    response.status(204).send(null)
  }

  /**
   * Handle HTTP request for CORS. This method is binded as a before hook
   * to the HTTP server.
   */
  public async handle ({ request, response }: HttpContextContract) {
    /**
     * Return early when CORS is not enabled for the current request
     */
    if (!this.isEnabled(request)) {
      return
    }

    const origin = request.header('origin')
    const isOptions = request.method() === 'OPTIONS'

    /**
     * If their is no Origin header present, then let the user-agent handle
     * this situation, since the request is outside the scope of CORS.
     */
    if (!origin) {
      return
    }

    const allowedOrigin = this.computeResponseOrigin(origin)

    /**
     * If origin is not allowed, then we don't set any of the cors headers
     */
    if (!allowedOrigin) {
      /**
       * Also end the OPTIONS request right away
       */
      if (isOptions) {
        this.endPreFlight(response)
      }

      return
    }

    /**
     * Set required headers for non options request.
     */
    if (!isOptions) {
      this.setOrigin(response, allowedOrigin)
      this.setCredentials(response)
      this.setExposedHeaders(response)
      return
    }

    /**
     * Everything below is for pre-flight (aka OPTIONS) request
     */
    const requestMethod = request.header('Access-Control-Request-Method')

    /**
     * End the request, when `Access-Control-Request-Method` is missing or isn't
     * part of allowed methods.
     * https://www.w3.org/TR/cors/#http-access-control-request-method
     */
    if (!requestMethod || this.options.methods.indexOf(requestMethod) === -1) {
      this.endPreFlight(response)
      return
    }

    /**
     * When `Access-Control-Request-Headers` header is missing or is empty, then
     * we subsitute that with an empty list.
     * https://www.w3.org/TR/cors/#http-access-control-request-headers
     */
    let requestHeaders: unknown = request.header('Access-Control-Request-Headers')
    if (requestHeaders && requestHeaders !== '') {
      requestHeaders = (requestHeaders as string).split(',')
    } else {
      requestHeaders = []
    }

    /**
     * Computing allowed headers array from the user config
     */
    const allowedHeaders = this.computedAllowedHeaders(requestHeaders as string[])

    /**
     * Finding if all request `Access-Control-Request-Headers` falls under the
     * list of allowed headers inside user config
     */
    const headersMatches = (requestHeaders as string[]).every((header) => {
      if (header === 'origin') {
        return true
      }

      /**
       * Doing case insenstive match
       */
      return allowedHeaders.indexOf(header.toLowerCase()) > -1
    })

    /**
     * If headers test fails, then we need to end the request without setting
     * any headers (part of spec).
     * https://www.w3.org/TR/cors/#http-access-control-request-headers
     */
    if (headersMatches === false) {
      this.endPreFlight(response)
      return
    }

    this.setOrigin(response, allowedOrigin)
    this.setCredentials(response)
    this.setExposedHeaders(response)
    this.setAllowMethods(response)
    this.setAllowHeaders(response, allowedHeaders)
    this.setMaxAge(response)
    this.endPreFlight(response)
  }
}

/**
 * Exposes a function to bind the CORS class as a server before hook.
 * We only add the hook when `enabled` is set to true or a function.
 *
 * Since in most cases users will use a boolean value (true or false),
 * it is better not to add CORS to the stack when it's disabled.
 */
export function serverHook (server: ServerContract, corsConfig: CorsConfigContract) {
  if (corsConfig.enabled) {
    const cors = new Cors(corsConfig)
    server.hooks.before(cors.handle.bind(cors))
  }
}
