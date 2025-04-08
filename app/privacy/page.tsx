"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function PrivacyPolicy() {
  return (
    <div className="max-w-[800px] mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      </div>

      <div className="prose prose-gray max-w-none">
        <p className="text-sm text-gray-500">Effective Date: March 4, 2024</p>

        <p>
          When you visit our website or use Stitchflow services, you trust us with information and data. 
          We are committed to keeping that trust, and that starts with helping you to understand our privacy practices.
        </p>

        <p>
          Stitchflow, Inc. ("Stitchflow", "we", or "our") operates the website www.stitchflow.com (the "Site") 
          to provide information about our services (the "Services"), which include without limitation offering 
          no-code cross-tool dashboards for Corporate IT via a license. We provide Services via an interactive 
          portion of the Site as well as through external applications.
        </p>

        <p>
          This privacy policy ("Privacy Policy") informs you of our policies regarding the collection, use and 
          disclosure of Personal Data (as defined) and other data when you use our Site or Services and the 
          choices you have associated with that data.
        </p>

        <p>
          We use your data to provide and improve the Site and Services and to collect data to market our Services. 
          By using the Site or Services, you agree to the collection and use of data in accordance with this policy.
        </p>

        <p>
          We collect several different types of data for various purposes to provide and improve our Site and 
          Services to you.
        </p>

        <p>
          Stitchflow's use and transfer to any other app of information received from Google APIs will adhere to 
          the Google API Services User Data Policy, including the Limited Use requirements.
        </p>

        <p className="font-semibold">
          PLEASE NOTE THAT WE WILL NEVER SELL YOUR PERSONAL INFORMATION OR DATA TO ANY THIRD PARTY.
        </p>

        <h2>I. Types of Data Collected</h2>

        <h3>A. Personal Data</h3>

        <h4>Your Interactions with Us</h4>

        <p>
          When you browse or visit our Site, contact us, or set up a user account with us, we might collect 
          information that you voluntarily provide to us, such as through a web form, in an email or other 
          message (including in the "envelope" of the message, such as the From: or Subject: lines), or during 
          the account creation process. The information we or our vendors collect directly from you may include:
        </p>

        <ul>
          <li>Identifiers, such as your name, business address, email address, and similar identifiers</li>
          <li>Transaction Information, such as the Stitchflow products or services you've purchased or considered purchasing, and similar commercial information</li>
          <li>Professional or Employment-Related Information, such as your job title and/or roles within your employer</li>
          <li>Financial Information, such as credit card or other banking information, billing name, and billing address, if you purchase services from us</li>
          <li>Support Service Information, such as messages submitted to us through email or customer support, and summaries or voice recordings of interactions with our customer service personnel</li>
          <li>Other Information You Provide, such as if you provide feedback, comments, or other information through communications with us</li>
        </ul>

        <p>
          We may use your Personal Data to contact you with marketing or promotional materials, such as newsletters, 
          and other data that may be of interest to you. You may opt out of receiving any or all of these 
          communications from us by following an unsubscribe link or instructions provided in any email we send.
        </p>

        <h4>Information from Third Parties</h4>

        <p>
          In connection with the use of the Services, Stitchflow will collect data from third-party systems that 
          are integrated with the Services. These integrations are authorized and enabled by the Administrators 
          of a Stitchflow account. The information we collect directly from third-party systems will vary based 
          on the system and may include:
        </p>

        <ul>
          <li>Identifiers, such as your name, gender, preferred language, IP address, device information and similar identifiers</li>
          <li>Contact data, such as email address and phone number</li>
          <li>Location data, such as home address, work site location, and general geographic region</li>
          <li>System user data, such as login name, system display name, and connected devices</li>
          <li>Employment data, such as, job title, manager, department name, employment type and employment status</li>
        </ul>

        <p>
          We may disclose updates and modifications to the above information back to the originating third-party 
          system as part of the Services. Stitchflow will never use or transfer data obtained through Google's 
          APIs to serve users advertisements and will comply with Google API Services User Data Policy.
        </p>

        <h3>B. Usage Data</h3>

        <p>
          We may collect data on how the Site is accessed and used ("Usage Data"). This Usage Data may include 
          data such as your computer's Internet Protocol address, browser type, browser version, the pages of our 
          Site that you visit, the time and date of your visit, the time spent on those pages, unique device 
          identifiers, and other diagnostic data.
        </p>

        <h3>C. Location Data</h3>

        <p>
          We may use and store data about your location if you give us permission to do so ("Location Data"). 
          We may use this data to provide additional Site features or to improve and customize our Site. You can 
          enable or disable location services when you use our Site at any time by way of your device settings.
        </p>

        <h3>D. Tracking Cookies Data</h3>

        <p>
          We may use Cookies (a small amount of data, which often includes an anonymous unique identifier, that is 
          sent to your browser from a web site's computers and stored on your computer's hard drive) and similar 
          tracking technologies to track the activity on our Site, and these Cookies and technologies hold certain 
          data. We may also use other tracking technologies such as beacons, tags, and scripts to collect and track 
          data and to improve and analyze our Site and Services. You can instruct your browser to refuse all 
          Cookies or to indicate when a Cookie is being sent. However, if you do not accept Cookies, you may not 
          be able to use some portions of our Site and Services.
        </p>

        <h4>Here are examples of Cookies we may use:</h4>

        <ul>
          <li>Session Cookies. We use Session Cookies to operate our Site.</li>
          <li>Preference Cookies. We use Preference Cookies to remember your preferences and various settings.</li>
          <li>Security Cookies. We use Security Cookies for security purposes.</li>
        </ul>

        <h2>II. Data Use</h2>

        <p>Stitchflow may use the data it collects for various purposes:</p>

        <ul>
          <li>To provide and maintain our Site and Services</li>
          <li>To provide a mechanism for secure authentication to our Services</li>
          <li>To notify you about changes to our Site and Services</li>
          <li>To allow you to participate in interactive features of our Site and Services when you choose to do so</li>
          <li>To provide customer support</li>
          <li>To gather analysis or valuable data so that we can improve our Site and Services</li>
          <li>To monitor the usage of our Site and Services</li>
          <li>To detect, prevent, and address technical issues</li>
          <li>To provide you with news, special offers, and general data about other goods, services, and events which we offer that are similar to those that you have already purchased or inquired about unless you have opted not to receive such data</li>
        </ul>

        <h2>III. Data Retention and Transfer</h2>

        <p>
          Stitchflow will retain your Personal Data only for as long as is necessary for the purposes set out in 
          this Privacy Policy. We will retain and use your Personal Data to the extent necessary to comply with 
          our legal obligations (for example, if we are required to retain your data to comply with applicable 
          laws), resolve disputes, and enforce our legal agreements and policies.
        </p>

        <p>
          Typically, we retain Personal Data about you for as long as you have an open user account with us and for 
          twelve (12) months after you close your user account. Thereafter, we retain some data in a depersonalized 
          or aggregated form but not in a way that would identify you personally.
        </p>

        <p>
          Stitchflow will also retain Usage Data for internal analysis purposes. Usage Data is generally retained 
          for a shorter period of time, except when this data is used to strengthen the security or to improve the 
          functionality of our Site, or we are legally obligated to retain this data for longer periods.
        </p>

        <p>
          Your data, including Personal Data, may be transferred to and maintained on computers located outside of 
          your state, province, country, or other governmental jurisdiction where the data protection laws may 
          differ from those of your jurisdiction.
        </p>

        <p>
          If you are located outside the United States and choose to provide data to us, please note that we 
          transfer the data, including Personal Data, to the United States and process it there.
        </p>

        <p>
          Your consent to this Privacy Policy followed by your submission of such data represents your agreement 
          to that transfer.
        </p>

        <p>
          Stitchflow will take all steps reasonably necessary to ensure that your data is treated securely and in 
          accordance with this Privacy Policy and that no transfer of your Personal Data take place to an 
          organization or a country unless there are adequate controls in place including the security of your 
          data and other personal data.
        </p>

        <h2>IV. Data Disclosure</h2>

        <h3>A. Business Transaction</h3>

        <p>
          If Stitchflow is involved in a merger, acquisition, or asset sale, your Personal Data may be transferred. 
          We will provide notice before your Personal Data is transferred and becomes subject to a different 
          Privacy Policy.
        </p>

        <h3>B. Disclosure for Law Enforcement</h3>

        <p>
          Under certain circumstances, Stitchflow may be required to disclose your Personal Data if required to do 
          so by law or in response to valid requests by public authorities (e.g., a court or a government agency).
        </p>

        <h2>V. Data Security</h2>

        <p>
          The security of your data is important to us, but remember that no method of transmission over the 
          Internet, or method of electronic storage is 100% secure. While we strive to use commercially acceptable 
          means to protect your Personal Data, we cannot guarantee its absolute security.
        </p>

        <h2>VI. Our Policy on "Do Not Track" Signals under the California Online Protection Act ("CalOPPA")</h2>

        <p>
          We do not support Do Not Track ("DNT"). DNT is a preference you can set in your web browser to inform 
          websites that you do not want to be tracked. You can enable or disable DNT by visiting the Preferences 
          or Settings page of your web browser.
        </p>

        <h2>VII. Your Data Protection Rights under the GDPR</h2>

        <p>
          If you are a resident of the European Economic Area, you have certain data protection rights. Stitchflow 
          aims to take reasonable steps to allow you to correct, amend, delete, or limit the use of your Personal 
          Data. If you wish to be informed about what Personal Data we hold about you and if you want it to be 
          removed from our systems, please contact us.
        </p>

        <p>In certain circumstances, you have the following data protection rights:</p>

        <ul>
          <li>The right to access, update or to delete the information we have on you</li>
          <li>The right of rectification</li>
          <li>The right to object</li>
          <li>The right of restriction</li>
          <li>The right to data portability</li>
          <li>The right to withdraw consent</li>
        </ul>

        <h2>VIII. Legal Basis for Processing Personal Data Under the GDPR</h2>

        <p>
          If you are from the European Economic Area ("EEA"), Stitchflow's legal basis for collecting and using 
          the personal data described in this Privacy Policy depends on the Personal Data we collect and the 
          specific context in which we collect it.
        </p>

        <p>Stitchflow may process your Personal Data because:</p>

        <ul>
          <li>We need to perform a contract with you</li>
          <li>You have given us permission to do so</li>
          <li>The processing is in our legitimate interests and it is not overridden by your rights</li>
          <li>To comply with the law</li>
        </ul>

        <h2>IX. Site Providers</h2>

        <p>
          We may employ third-party companies and individuals to facilitate our Site ("Site Providers"), to 
          provide the Site on our behalf, to perform Site-related services or to assist us in analyzing how our 
          Site is used.
        </p>

        <p>
          These third parties have access to your Personal Data only to perform these tasks on our behalf and are 
          obligated not to disclose or use it for any other purpose.
        </p>

        <h2>X. Links to Other Sites</h2>

        <p>
          Our Site may contain links to other sites that are not operated by us. If you click on a third party 
          link, you will be directed to that third party's site. We strongly advise you to review the Privacy 
          Policy of every site you visit.
        </p>

        <p>
          We have no control over and assume no responsibility for the content, privacy policies or practices of 
          any third party sites or services.
        </p>

        <h2>XI. Children's Privacy</h2>

        <p>
          Our Site does not address anyone under the age of 18 ("Children"). We do not knowingly collect 
          personally identifiable information from Children. If you become aware that a Child has provided us 
          with Personal Data, please contact us. If we become aware that we have collected Personal Data from 
          Children without verification of parental consent, we take steps to remove that information from our 
          servers.
        </p>

        <h2>XII. Changes to This Privacy Policy</h2>

        <p>
          We may update our Privacy Policy from time to time. We will notify you of any changes by posting the 
          new Privacy Policy on this page and updating the "effective date" at the top of this Privacy Policy.
        </p>

        <p>
          You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy 
          Policy are effective when they are posted on this page.
        </p>

        <h2>XIII. Contact Us</h2>

        <p>
          If you have any questions about this Privacy Policy, please contact us at legal@stitchflow.io.
        </p>
      </div>
    </div>
  )
} 