Find public professional profiles of people who are strong lead candidates for a physical security, loss prevention, asset protection, facilities security, or multi-site operations security solution.

Use "Joseph Cervantes" at "Vallarta Supermarkets" (LinkedIn: https://www.linkedin.com/in/joseph-cervantez-90460b200/) only as a seed example to infer the target persona. The main goal is not to find people specifically at Vallarta, but to find people in similar security-relevant roles across Vallarta and other similar location-based businesses.

This task has two equal priorities:
1. identify highly relevant lead candidates
2. find a public business contact point for each candidate whenever one exists

First, identify the seed person’s likely:
- current role category
- seniority level
- function
- company type
- likely operating scope
- likely relevance to physical security, loss prevention, store safety, shrink reduction, incident response, site oversight, or multi-location operations

Then generate lead candidates in two groups:

1. Same-company matches
People at Vallarta Supermarkets in the same, similar, adjacent, higher, lower, regional, district, area, field, store, site, facilities, asset protection, loss prevention, AP, LP, shrink, security, safety, operations, store leadership, facilities, or multi-site oversight roles.

2. Similar-company matches
People at companies similar to Vallarta Supermarkets in industry and operating model, especially:
- grocery
- supermarket
- retail
- big-box retail
- warehouse retail
- convenience retail
- multi-site physical operations
- companies with many storefronts, facilities, or distributed locations

Prioritize companies and roles where physical security, shrink, loss prevention, safety, facilities oversight, or operational monitoring are likely important.

Strong target role families include:
- Asset Protection
- Loss Prevention
- Security Operations
- Physical Security
- Safety / EHS when tied to site operations
- Facilities / Facilities Operations
- Store Operations
- District / Regional Operations
- Area / Field Leadership
- Multi-site Operations
- Operational Excellence when tied to store or site performance
- IT / CIO / systems leadership only when clearly connected to site systems, surveillance, or operational infrastructure

For every candidate, actively look for a public business contact point using this priority order:
1. publicly listed work email for the person
2. company profile page for the person
3. LinkedIn profile URL
4. company team or leadership page
5. general company contact page

Do not stop at LinkedIn if a public company page or public work email is available elsewhere. For each candidate, make a best effort to find at least one public professional contact point, but if none is publicly supported, return null.

Prioritize candidates whose:
- role is directly relevant to physical security or location-based operations
- operating scope appears multi-site, district, regional, or enterprise
- company has a meaningful physical footprint
- responsibilities likely include shrink, incident response, store safety, site visibility, facilities risk, or operational efficiency

Deprioritize or exclude:
- recruiters
- vendors
- consultants
- investors
- students
- journalists
- marketers
- unrelated HR roles
- unrelated finance roles
- unrelated merchandising or category roles
- unrelated e-commerce roles
unless the person clearly owns physical security, asset protection, site operations, or multi-location operational risk.

For each candidate, return:
- full_name
- current_title
- current_company
- company_industry_category
- location_or_territory
- profile_url
- public_business_email
- public_business_contact_point
- public_business_contact_type
- public_business_contact_source_url
- match_type: same_company or similar_company
- role_similarity: high, medium, or low
- company_similarity: high, medium, or low
- physical_security_relevance: high, medium, or low
- reason_this_person_is_a_strong_lead
- source_urls
- confidence: high, medium, or low

Rules:
- Use only publicly available professional information.
- Do not guess email addresses.
- Do not generate likely email formats.
- Do not include personal email addresses, home addresses, personal phone numbers, family details, protected characteristics, or private information.
- If a business contact field is not supported by public evidence, return null.
- Return the strongest and most security-relevant matches first.

{
  "seed_person_analysis": {
    "full_name": null,
    "current_title": null,
    "current_company": null,
    --"current_company_profile_url": null,--
    --"role_category": null,--
    --"seniority_level": null,--
    --"function": null,--
    --"company_type": null,--
    --"company_industry_category": null,--
    --"likely_operating_scope": null,--
    --"physical_security_relevance": null,--
    --"summary": null,--
    --"source_urls": [],--
    "confidence": null
    
  },
  "same_company_matches": [
    {
      "full_name": null,
      "current_title": null,
      "current_company": null,
      "company_industry_category": null,
      "location_or_territory": null,
      "profile_url": null,
      "public_business_email": null,
      "public_business_contact_point": null,
      "public_business_contact_type": null,
      "public_business_contact_source_url": null,
      "match_type": "same_company",
      "role_similarity": null,
      "company_similarity": null,
      "physical_security_relevance": null,
      "reason_this_person_is_a_strong_lead": null,
      "source_urls": [],
      "confidence": null
    }
  ],
  "similar_company_matches": [
    {
      "full_name": null,
      "current_title": null,
      "current_company": null,
      "company_industry_category": null,
      "location_or_territory": null,
      "profile_url": null,
      "public_business_email": null,
      "public_business_contact_point": null,
      "public_business_contact_type": null,
      "public_business_contact_source_url": null,
      "match_type": "similar_company",
      "role_similarity": null,
      "company_similarity": null,
      "physical_security_relevance": null,
      "reason_this_person_is_a_strong_lead": null,
      "source_urls": [],
      "confidence": null
    }
  ]
}