import { z } from "zod"

// Yelp API types
interface YelpBusinessSearchResponse {
  businesses: YelpBusiness[]
  total: number
  region: {
    center: {
      latitude: number
      longitude: number
    }
  }
}

interface YelpBusiness {
  id: string
  alias: string
  name: string
  image_url: string
  is_closed: boolean
  url: string
  review_count: number
  categories: Array<{
    alias: string
    title: string
  }>
  rating: number
  coordinates: {
    latitude: number
    longitude: number
  }
  transactions: string[]
  price?: string
  location: {
    address1: string
    address2?: string
    address3?: string
    city: string
    zip_code: string
    country: string
    state: string
    display_address: string[]
  }
  phone: string
  display_phone: string
  distance?: number
}

export interface StoreYelpData {
  businessId: string
  rating: number
  reviewCount: number
  url: string
  matchScore: number // Confidence score of the match (0-1)
}

// Simple string similarity function using Levenshtein distance
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1
  const longerLength = longer.length
  
  if (longerLength === 0) {
    return 1.0
  }
  
  const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase())
  return (longerLength - distance) / longerLength
}

function levenshteinDistance(s1: string, s2: string): number {
  const matrix = []
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  return matrix[s2.length][s1.length]
}

export class YelpService {
  private readonly apiKey: string
  private readonly baseUrl = "https://api.yelp.com/v3"
  
  constructor() {
    const apiKey = process.env.YELP_API_KEY
    if (!apiKey) {
      throw new Error("YELP_API_KEY environment variable is required")
    }
    this.apiKey = apiKey
  }
  
  private async makeRequest(endpoint: string, params: Record<string, any>): Promise<any> {
    const url = new URL(`${this.baseUrl}${endpoint}`)
    
    // Add search parameters
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key].toString())
      }
    })
    
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        }
      })
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Yelp API rate limit exceeded")
        }
        if (response.status === 401) {
          throw new Error("Invalid Yelp API key")
        }
        throw new Error(`Yelp API error: ${response.status} ${response.statusText}`)
      }
      
      return await response.json()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error("Failed to fetch data from Yelp API")
    }
  }
  
  async searchBusinessesByLocation(
    storeName: string, 
    address: string, 
    phone?: string
  ): Promise<YelpBusiness[]> {
    const searchParams = {
      term: storeName,
      location: address,
      categories: 'restaurants,food',
      limit: 10,
      sort_by: 'distance'
    }
    
    const response: YelpBusinessSearchResponse = await this.makeRequest('/businesses/search', searchParams)
    return response.businesses || []
  }
  
  findBestMatch(
    storeName: string,
    storeAddress: string,
    storePhone: string | null,
    businesses: YelpBusiness[]
  ): StoreYelpData | null {
    if (businesses.length === 0) {
      return null
    }
    
    let bestMatch: YelpBusiness | null = null
    let bestScore = 0
    
    for (const business of businesses) {
      let score = 0
      
      // Name similarity (weighted heavily)
      const nameSimilarity = similarity(storeName, business.name)
      score += nameSimilarity * 0.6
      
      // Address similarity
      const businessFullAddress = business.location.display_address.join(' ').toLowerCase()
      const storeAddressClean = storeAddress.toLowerCase()
      const addressSimilarity = similarity(storeAddressClean, businessFullAddress)
      score += addressSimilarity * 0.3
      
      // Phone number exact match (bonus points)
      if (storePhone && business.phone) {
        const cleanStorePhone = storePhone.replace(/\D/g, '')
        const cleanBusinessPhone = business.phone.replace(/\D/g, '')
        if (cleanStorePhone === cleanBusinessPhone) {
          score += 0.2
        }
      }
      
      // Exact name match gets bonus
      if (storeName.toLowerCase() === business.name.toLowerCase()) {
        score += 0.1
      }
      
      // Only consider matches with reasonable confidence
      if (score > bestScore && score >= 0.5) {
        bestScore = score
        bestMatch = business
      }
    }
    
    if (!bestMatch || bestScore < 0.5) {
      return null
    }
    
    return {
      businessId: bestMatch.id,
      rating: bestMatch.rating,
      reviewCount: bestMatch.review_count,
      url: bestMatch.url,
      matchScore: bestScore
    }
  }
  
  async getStoreYelpData(
    storeName: string,
    address: string | null,
    phone: string | null
  ): Promise<StoreYelpData | null> {
    if (!address) {
      console.warn(`Cannot search Yelp for store "${storeName}" without address`)
      return null
    }
    
    try {
      const businesses = await this.searchBusinessesByLocation(storeName, address, phone || undefined)
      return this.findBestMatch(storeName, address, phone, businesses)
    } catch (error) {
      console.error(`Failed to fetch Yelp data for store "${storeName}":`, error)
      return null
    }
  }
}

// Singleton instance
let yelpService: YelpService | null = null

export function getYelpService(): YelpService {
  if (!yelpService) {
    yelpService = new YelpService()
  }
  return yelpService
}